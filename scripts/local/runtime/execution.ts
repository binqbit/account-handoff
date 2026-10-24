import { readFileSync } from "node:fs";
import { join } from "node:path";
import { u8aToHex, blake2AsHex } from "dedot/utils";
import {
  signatureBytes,
  plain,
  type NativeAction,
  type NativeReceipt,
  type Hex,
} from "@account-handoff/native-adapter";
import { verifyNativeSignature } from "@account-handoff/wallet-adapter";
import type { LocalRuntime, NativeExecution, Step, Role } from "./types.js";
import { save } from "./journal.js";
import { requireCondition } from "./guards.js";
import { restoreAction } from "./calls.js";
export function createNativeExecution(runtime: LocalRuntime): NativeExecution {
  const {
    directory,
    run,
    session,
    sessionPath,
    connection,
    actors,
    pairs,
    fingerprint,
  } = runtime;
  function assertOutcome(
    name: string,
    receipt: NativeReceipt,
    expectedFailure: boolean,
  ) {
    requireCondition(
      receipt.outerSuccess,
      `Step ${name} outer execution failed: ${receipt.failure}`,
    );
    requireCondition(
      expectedFailure ? !receipt.nestedSuccess : receipt.nestedSuccess,
      `Step ${name} nested execution had an unexpected outcome: ${receipt.failure}`,
    );
  }

  async function transact(
    name: string,
    actionInput: NativeAction | (() => Promise<NativeAction>),
    role: Role,
    expectedFailure = false,
  ): Promise<NativeReceipt> {
    const currentRun = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as { generation: number; status: string };
    requireCondition(
      currentRun.generation === run.generation &&
        currentRun.status === "running",
      "LOCAL run changed or stopped during operation",
    );
    const old = session.steps[name];
    if (old) {
      requireCondition(
        old.status === "finalized" && old.receipt,
        `Step ${name} has an unresolved outcome. Reconcile its retained transaction ${old.txHash ?? "(no hash)"} before replacement.`,
      );
      requireCondition(
        old.expectedFailure === expectedFailure,
        `Step ${name} changed expected outcome`,
      );
      requireCondition(old.actor === role, `Step ${name} changed actor`);
      assertOutcome(name, old.receipt, expectedFailure);
      return old.receipt;
    }
    const nativeAction =
      typeof actionInput === "function" ? await actionInput() : actionInput;
    const tx = connection.transaction(nativeAction);
    const prepared = await connection.prepareSigning(tx, actors[role]);
    requireCondition(
      prepared.fingerprint.genesis === fingerprint.genesis &&
        prepared.fingerprint.runtimeCodeHash === fingerprint.runtimeCodeHash &&
        prepared.fingerprint.metadataSha256 === fingerprint.metadataSha256,
      "The qualified runtime changed before the LOCAL signature",
    );
    const entry: Step = {
      status: "prepared",
      startBlock: prepared.fingerprint.anchor.number,
      actor: role,
      callHash: prepared.callHash,
      prepared: plain(prepared),
      action: plain(nativeAction),
      expectedFailure,
    };
    session.steps[name] = entry;
    save(sessionPath, session);
    const signature = u8aToHex(
      pairs[role].sign(signatureBytes(prepared.rawPayload), {
        withType: true,
      }),
    ) as Hex;
    requireCondition(
      await verifyNativeSignature(
        prepared.rawPayload,
        signature,
        actors[role],
        "sr25519",
      ),
      "LOCAL signature does not match its exact reviewed payload",
    );
    const signedBytes = connection.attachSignature(prepared, signature);
    entry.signedBytes = signedBytes;
    entry.txHash = blake2AsHex(signedBytes);
    entry.status = "signed";
    save(sessionPath, session);
    entry.status = "broadcast-unknown";
    save(sessionPath, session);
    const beforeSend = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as { generation: number; status: string };
    requireCondition(
      beforeSend.generation === run.generation &&
        beforeSend.status === "running",
      "LOCAL run changed before broadcast",
    );
    let receipt: NativeReceipt;
    try {
      receipt = await connection.send(signedBytes);
      requireCondition(
        receipt.txHash === entry.txHash,
        "Provider returned a different extrinsic hash",
      );
      receipt = await connection.receiptAt(receipt.blockHash, entry.txHash);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      save(sessionPath, session);
      throw error;
    }
    entry.receipt = receipt;
    entry.status = "finalized";
    save(sessionPath, session);
    assertOutcome(name, receipt, expectedFailure);
    return receipt;
  }

  async function multisig(
    name: string,
    controller: Hex,
    members: Hex[],
    roles: [Role, Role],
    input: NativeAction | (() => Promise<NativeAction>),
    expectedFailure = false,
  ) {
    const completed = session.steps[`${name}-${roles[1]}`];
    if (completed?.status === "finalized" && completed.receipt) {
      assertOutcome(name, completed.receipt, expectedFailure);
      return completed.receipt;
    }
    const frozen = session.operations[name];
    const inner = frozen
      ? restoreAction(frozen.inner)
      : typeof input === "function"
        ? await input()
        : input;
    const innerTx = connection.transaction(inner);
    const callHash = blake2AsHex(innerTx.callHex);
    if (frozen)
      requireCondition(
        frozen.callHash === callHash,
        `Retained operation ${name} no longer encodes identically`,
      );
    const estimatedWeight = frozen
      ? {
          refTime: BigInt(frozen.weight.refTime),
          proofSize: BigInt(frozen.weight.proofSize),
        }
      : await connection.dispatchWeight(innerTx);
    const weight = frozen
      ? estimatedWeight
      : {
          refTime: estimatedWeight.refTime + 1n,
          proofSize: estimatedWeight.proofSize + 1n,
        };
    if (!frozen) {
      session.operations[name] = {
        inner: plain(inner),
        callHash,
        weight: {
          refTime: weight.refTime.toString(),
          proofSize: weight.proofSize.toString(),
        },
      };
      save(sessionPath, session);
    }
    let result: NativeReceipt | undefined;
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      const existing = session.steps[`${name}-${role}`];
      if (existing?.status === "finalized" && existing.receipt) {
        result = existing.receipt;
        continue;
      }
      const proposal = await connection.proposal(controller, callHash);
      requireCondition(
        i !== 0 || proposal === null,
        `An unrecorded ${name} proposal already exists; reconcile its incarnation before approving`,
      );
      requireCondition(
        i === 0 || proposal,
        `Missing expected pending proposal for ${name}; cannot invent a timepoint`,
      );
      if (i > 0 && proposal) {
        const first = session.steps[`${name}-${roles[0]}`]?.receipt;
        requireCondition(
          first &&
            proposal.when.height === first.blockNumber &&
            proposal.when.index === first.txIndex &&
            proposal.depositor === actors[roles[0]],
          `The ${name} proposal incarnation changed after the first approval`,
        );
      }
      result = await transact(
        `${name}-${role}`,
        {
          kind: "multisig",
          threshold: 2,
          others: members.filter((member) => member !== actors[role]).sort(),
          timepoint: proposal?.when,
          inner,
          weight,
        },
        role,
        i === 1 && expectedFailure,
      );
    }
    requireCondition(result, `No final receipt for ${name}`);
    const execution = result.events.find(
      (item) => item.pallet === "Multisig" && item.name === "MultisigExecuted",
    );
    requireCondition(
      execution &&
        String(execution.data["callHash"]).toLowerCase() === callHash,
      `The final ${name} approval did not execute the exact committed call`,
    );
    requireCondition(
      (await connection.proposal(controller, callHash, result.blockHash)) ===
        null,
      `The executed ${name} proposal was not consumed at its finalized checkpoint`,
    );
    return result;
  }

  return { transact, multisig };
}

export async function reconcile(runtime: LocalRuntime): Promise<void> {
  const { connection, session, sessionPath } = runtime;

  const now = await connection.fingerprint();
  const unresolved: string[] = [];
  for (const [name, step] of Object.entries(session.steps)) {
    if (step.status === "finalized") continue;
    if (!step.txHash || now.anchor.number - step.startBlock > 2048) {
      unresolved.push(name);
      continue;
    }
    const receipt = await connection.findReceipt(
      step.txHash,
      Math.max(1, now.anchor.number - step.startBlock + 1),
    );
    if (!receipt) {
      unresolved.push(name);
      continue;
    }
    step.receipt = receipt;
    step.status = "finalized";
    save(sessionPath, session);
  }
  requireCondition(
    unresolved.length === 0,
    `No conclusive receipt for ${unresolved.join(", ")}; no new signature or broadcast was attempted`,
  );
}
