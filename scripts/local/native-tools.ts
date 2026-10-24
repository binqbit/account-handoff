/** Explicit LOCAL-only native operator. Never imported by the browser bundle. */
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  fsyncSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Keyring } from "@polkadot/keyring";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady, createKeyMulti } from "@polkadot/util-crypto";
import { u8aToHex, blake2AsHex } from "dedot/utils";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import {
  NativeConnection,
  type NativeAction,
  type NativeReceipt,
  type Hex,
  account,
  contractAddress,
  signatureBytes,
  plain,
} from "@account-handoff/native-adapter";
import {
  vestryAbi,
  ZERO_ADDRESS,
  encodeCreateGrant,
  encodeSubmission,
  encodeApproval,
  readGrant,
  verifyGrantConstants,
  decodeGrantEvent,
} from "@account-handoff/grant-adapter";
import { verifyNativeSignature } from "@account-handoff/wallet-adapter";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const UNIT = 100_000_000_000_000n;
const EVM_UNIT = 1_000_000_000_000_000_000n;
const ZERO4 = "0x00000000" as Hex;
type Role = "A" | "B" | "C" | "D" | "F" | "R1" | "R2";
type Step = {
  status: "prepared" | "signed" | "broadcast-unknown" | "finalized";
  startBlock: number;
  actor: Role;
  callHash: Hex;
  prepared: unknown;
  action: unknown;
  signedBytes?: Hex;
  txHash?: Hex;
  receipt?: NativeReceipt;
  expectedFailure?: boolean;
  error?: string;
};
interface Session {
  formatVersion: 1;
  mode: "LOCAL";
  runId: string;
  generation: number;
  genesis: Hex;
  contract: Hex;
  actors: Record<Role, Hex>;
  m0: Hex;
  m1: Hex;
  p?: Hex;
  grantId?: string;
  steps: Record<string, Step>;
  baseline?: unknown;
  rotation?: unknown;
  continuation?: unknown;
  dualControl?: unknown;
  cancellationProbe?: { reservedBefore: string; callHash: Hex };
  maintenance?: unknown;
  operations: Record<
    string,
    {
      inner: unknown;
      callHash: Hex;
      weight: { refTime: string; proofSize: string };
    }
  >;
  fixture?: { deadline: string };
}
function options() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith("--") || !value)
      throw new Error("Arguments require --name value pairs");
    out[key.slice(2)] = value;
  }
  return out;
}
function save(path: string, value: unknown) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify(
      value,
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      2,
    ) + "\n",
    { mode: 0o600, flush: true },
  );
  renameSync(temporary, path);
  const directory = openSync(resolve(path, ".."), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
function valueHex(value: unknown): Hex {
  if (typeof value === "string") return value as Hex;
  if (
    value &&
    typeof value === "object" &&
    "raw" in value &&
    typeof value.raw === "string"
  )
    return value.raw as Hex;
  throw new Error("Expected a native hexadecimal identity in finalized event");
}
function acquireRunLock(directory: string, action: string): () => void {
  const path = join(directory, ".native-operation.lock.json");
  const token = randomUUID();
  if (existsSync(path)) {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch {
      alive = false;
    }
    requireCondition(
      !alive && action === "reconcile",
      "Another LOCAL operation owns this run, or a crashed run requires local:reconcile first",
    );
    unlinkSync(path);
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token, action }));
  } finally {
    closeSync(fd);
  }
  return () => {
    if (
      existsSync(path) &&
      (JSON.parse(readFileSync(path, "utf8")) as { token: string }).token ===
        token
    )
      unlinkSync(path);
  };
}
function restoreAction(value: unknown): NativeAction {
  requireCondition(
    value && typeof value === "object" && "kind" in value,
    "Invalid retained native operation",
  );
  const action = value as Record<string, unknown>;
  switch (action["kind"]) {
    case "transfer":
      return {
        kind: "transfer",
        destination: String(action["destination"]),
        amount: BigInt(String(action["amount"])),
      };
    case "create-pure":
      return { kind: "create-pure", index: Number(action["index"]) };
    case "map-account":
      return { kind: "map-account" };
    case "add-proxy":
    case "remove-proxy":
      return { kind: action["kind"], delegate: String(action["delegate"]) };
    case "proxy":
      return {
        kind: "proxy",
        beneficiary: String(action["beneficiary"]),
        inner: restoreAction(action["inner"]),
      };
    case "revive-call": {
      const weight = action["weight"] as Record<string, string>;
      return {
        kind: "revive-call",
        destination: valueHex(action["destination"]),
        value: BigInt(String(action["value"])),
        storage: BigInt(String(action["storage"])),
        data: valueHex(action["data"]),
        weight: {
          refTime: BigInt(weight["refTime"]!),
          proofSize: BigInt(weight["proofSize"]!),
        },
      };
    }
    default:
      throw new Error("Unsupported retained inner operation");
  }
}

async function main() {
  const args = options();
  const id = args["run"] ?? "development";
  const action = args["action"] ?? "seed";
  requireCondition(
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(id),
    "Invalid LOCAL run identifier",
  );
  requireCondition(
    ["seed", "handoff", "inspect", "negative", "reconcile"].includes(action),
    "Unknown LOCAL native action",
  );
  const directory = join(ROOT, ".local-state", id);
  const run = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as {
    owner: string;
    mode: string;
    runId: string;
    generation: number;
    nativeRpc: string;
    status: string;
    genesisHash: Hex;
  };
  requireCondition(
    run.owner === "account-handoff" &&
      run.mode === "LOCAL" &&
      run.runId === id &&
      run.status === "running",
    "A running owned LOCAL environment is required",
  );
  const deployment = JSON.parse(
    readFileSync(join(directory, "deployment.json"), "utf8"),
  ) as { generation: number; status: string; contractAddress: Hex };
  requireCondition(
    deployment.generation === run.generation &&
      deployment.status === "VERIFIED",
    "An independently verified contract deployment is required",
  );
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const pairs: Record<Role, KeyringPair> = {
    A: keyring.addFromUri("//Alice"),
    B: keyring.addFromUri("//Bob"),
    C: keyring.addFromUri("//Charlie"),
    D: keyring.addFromUri("//Dave"),
    F: keyring.addFromUri("//Eve"),
    R1: keyring.addFromUri("//Ferdie"),
    R2: keyring.addFromUri("//Alice//stash"),
  };
  const actors = Object.fromEntries(
    Object.entries(pairs).map(([role, pair]) => [role, account(pair.address)]),
  ) as Record<Role, Hex>;
  const m0 = account(
    u8aToHex(createKeyMulti([actors.A, actors.B, actors.C].sort(), 2)),
  );
  const m1 = account(
    u8aToHex(createKeyMulti([actors.A, actors.B, actors.D].sort(), 2)),
  );
  const sessionPath = join(directory, "seed.json");
  const releaseLock = acquireRunLock(directory, action);
  const connection = await NativeConnection.connect(
    run.nativeRpc,
    "LOCAL",
  ).catch((error) => {
    releaseLock();
    throw error;
  });
  try {
    const fingerprint = await connection.fingerprint();
    requireCondition(
      fingerprint.specName === "account-handoff-local" &&
        fingerprint.genesis === run.genesisHash &&
        fingerprint.tokenDecimals === 14,
      "LOCAL runtime identity mismatch",
    );
    const session: Session = existsSync(sessionPath)
      ? (JSON.parse(readFileSync(sessionPath, "utf8")) as Session)
      : {
          formatVersion: 1,
          mode: "LOCAL",
          runId: id,
          generation: run.generation,
          genesis: fingerprint.genesis,
          contract: deployment.contractAddress,
          actors,
          m0,
          m1,
          steps: {},
          operations: {},
        };
    requireCondition(
      session.generation === run.generation &&
        session.genesis === fingerprint.genesis &&
        session.contract === deployment.contractAddress,
      "LOCAL seed belongs to a different environment generation/deployment",
    );
    save(sessionPath, session);

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
          i === 0 || proposal,
          `Missing expected pending proposal for ${name}; cannot invent a timepoint`,
        );
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
        (item) =>
          item.pallet === "Multisig" && item.name === "MultisigExecuted",
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
    const throughP = (p: Hex, inner: NativeAction): NativeAction => ({
      kind: "proxy",
      beneficiary: p,
      inner,
    });
    const proxySet = async (p: Hex, expected: Hex[]) => {
      const current = await connection.readAccount(p);
      const actual = current.proxies
        .map((proxy) => `${proxy.delegate}:${proxy.proxyType}:${proxy.delay}`)
        .sort();
      requireCondition(
        JSON.stringify(actual) ===
          JSON.stringify(
            expected.map((delegate) => `${delegate}:Any:0`).sort(),
          ),
        `Unexpected native authority inventory: ${JSON.stringify(actual)}`,
      );
      return current;
    };
    async function contractCall(
      origin: Hex,
      data: Hex,
      value = 0n,
    ): Promise<NativeAction> {
      const estimated = await connection.estimateContract(
        origin,
        session.contract,
        value,
        data,
      );
      return {
        kind: "revive-call",
        destination: session.contract,
        value,
        data,
        weight: estimated.weight,
        storage: estimated.storage + 10n * UNIT,
      };
    }
    function event(
      receipt: NativeReceipt,
      name: string,
    ): Record<string, unknown> {
      for (const item of receipt.events) {
        if (item.pallet !== "Revive" || item.name !== "ContractEmitted")
          continue;
        if (
          String(item.data["contract"]).toLowerCase() !==
          session.contract.toLowerCase()
        )
          continue;
        try {
          const decoded = decodeGrantEvent(
            valueHex(item.data["data"]),
            (item.data["topics"] as unknown[]).map(valueHex),
          ) as { eventName: string; args: Record<string, unknown> };
          if (decoded.eventName === name) return decoded.args;
        } catch {
          /* Other source-valid contract events remain separate. */
        }
      }
      throw new Error(
        `Finalized native receipt did not contain attributed ${name}`,
      );
    }

    if (action === "reconcile") {
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

    if (action === "seed" && !session.baseline) {
      await transact(
        "fund-actor-D",
        { kind: "transfer", destination: actors.D, amount: 100n * UNIT },
        "A",
      );
      await transact(
        "fund-M0",
        { kind: "transfer", destination: m0, amount: 1_000n * UNIT },
        "A",
      );
      const pureReceipt = await multisig(
        "create-pure",
        m0,
        [actors.A, actors.B, actors.C],
        ["A", "B"],
        { kind: "create-pure", index: 0 },
      );
      if (!session.p) {
        const pureEvent = pureReceipt.events.find(
          (item) => item.pallet === "Proxy" && item.name === "PureCreated",
        );
        requireCondition(
          pureEvent,
          "PureCreated event missing from final M0 receipt",
        );
        session.p = account(valueHex(pureEvent.data["pure"]));
        save(sessionPath, session);
      }
      const p = session.p;
      requireCondition(
        !p.endsWith("ee".repeat(12)),
        "Unsupported EE-suffix Pure identity",
      );
      await proxySet(p, [m0]);
      await transact(
        "fund-P",
        { kind: "transfer", destination: p, amount: 1_000n * UNIT },
        "A",
      );
      await multisig(
        "map-P",
        m0,
        [actors.A, actors.B, actors.C],
        ["A", "B"],
        throughP(p, { kind: "map-account" }),
      );
      for (const role of ["F", "R1", "R2"] as const) {
        const current = await connection.readAccount(actors[role]);
        if (current.mappedTo !== actors[role])
          await transact(`map-${role}`, { kind: "map-account" }, role);
      }
      const mapped = await connection.readAccount(p);
      requireCondition(
        mapped.mappedTo === p,
        "Pure mapping is not persistent and reversible",
      );
      await verifyGrantConstants(connection, actors.F, session.contract);
      if (!session.fixture) {
        session.fixture = {
          deadline: (
            (await connection.currentBlockTime()) / 1000n +
            86_400n
          ).toString(),
        };
        save(sessionPath, session);
      }
      const deadline = BigInt(session.fixture.deadline);
      const inputs = [
        {
          amount: 18n * EVM_UNIT,
          deadline,
          vestingBlocks: 1800,
          metricTarget: ZERO_ADDRESS,
          metricSelector: ZERO4,
          metricMin: 0n,
        },
        {
          amount: 12n * EVM_UNIT,
          deadline,
          vestingBlocks: 0,
          metricTarget: ZERO_ADDRESS,
          metricSelector: ZERO4,
          metricMin: 0n,
        },
      ];
      const createReceipt = await transact(
        "create-grant",
        () =>
          contractCall(
            actors.F,
            encodeCreateGrant(
              contractAddress(p),
              [contractAddress(actors.R1), contractAddress(actors.R2)],
              inputs,
            ),
            30n * UNIT,
          ),
        "F",
      );
      if (!session.grantId) {
        const created = event(createReceipt, "GrantCreated");
        requireCondition(
          String(created["funder"]).toLowerCase() ===
            contractAddress(actors.F) &&
            String(created["grantee"]).toLowerCase() === contractAddress(p) &&
            String(created["token"]).toLowerCase() === ZERO_ADDRESS &&
            BigInt(String(created["total"])) === 30n * EVM_UNIT &&
            Number(created["threshold"]) === 2,
          "GrantCreated does not match the reviewed native grant fixture",
        );
        requireCondition(
          Array.isArray(created["reviewers"]) &&
            JSON.stringify(
              created["reviewers"]
                .map(String)
                .map((a) => a.toLowerCase())
                .sort(),
            ) ===
              JSON.stringify(
                [contractAddress(actors.R1), contractAddress(actors.R2)].sort(),
              ),
          "Grant reviewer identities differ from the direct native actors",
        );
        session.grantId = String(created["grantId"]);
        save(sessionPath, session);
      }
      const grantId = BigInt(session.grantId);
      await multisig(
        "submit-m0",
        m0,
        [actors.A, actors.B, actors.C],
        ["A", "B"],
        async () =>
          throughP(
            p,
            await contractCall(
              p,
              encodeSubmission(
                grantId,
                0,
                "LOCAL initial milestone: independently verified work",
              ),
            ),
          ),
      );
      await transact(
        "approve-R1",
        () => contractCall(actors.R1, encodeApproval(grantId, 0)),
        "R1",
      );
      const released = await transact(
        "approve-R2",
        () => contractCall(actors.R2, encodeApproval(grantId, 0)),
        "R2",
      );
      event(released, "MilestoneReleased");
      const grant = await readGrant(
        connection,
        actors.F,
        session.contract,
        grantId,
      );
      const baseline = await proxySet(p, [m0]);
      requireCondition(
        grant.grantee.toLowerCase() === contractAddress(p) &&
          grant.funder.toLowerCase() === contractAddress(actors.F) &&
          grant.milestones[0]?.amount === 18n * EVM_UNIT &&
          grant.milestones[0]?.vestingBlocks === 1800 &&
          grant.milestones[1]?.amount === 12n * EVM_UNIT &&
          grant.milestones[1]?.vestingBlocks === 0 &&
          grant.milestones[0]?.state === 2 &&
          grant.milestones[1]?.state === 0,
        "Controlled grant baseline is invalid",
      );
      requireCondition(
        Array.isArray(baseline.vesting) && baseline.vesting.length > 0,
        "Native vesting schedule missing after first release",
      );
      requireCondition(
        (baseline.vesting as { locked: string; perBlock: string }[]).some(
          (schedule) =>
            BigInt(schedule.locked) === 18n * UNIT &&
            BigInt(schedule.perBlock) === (18n * UNIT) / 1800n,
        ),
        "The native schedule does not match the unchanged Vestry 18-token/1800-block tranche",
      );
      requireCondition(
        baseline.frozen > 0n,
        "The first tranche must remain actively locked at the baseline",
      );
      const holds = baseline.holds as { amount: string }[];
      requireCondition(
        Array.isArray(holds) &&
          JSON.stringify(holds).includes("AddressMapping"),
        "The fresh beneficiary has no attributable mapping hold",
      );
      const held = holds.reduce((sum, hold) => sum + BigInt(hold.amount), 0n);
      requireCondition(
        held > 0n && held === baseline.reserved,
        "Unexpected reserved/hold provenance on the fresh beneficiary",
      );
      session.baseline = {
        fingerprint: await connection.fingerprint(),
        beneficiary: baseline,
        grant: plain(grant),
        releasedBy: released.txHash,
        controller: await connection.readAccount(m0),
      };
      save(sessionPath, session);
    }
    const failureProbe = session.steps["probe-unauthorized-M1-D"]?.receipt;
    if (
      action === "seed" &&
      !(failureProbe?.outerSuccess && !failureProbe.nestedSuccess)
    ) {
      requireCondition(
        session.p && session.baseline,
        "A complete baseline is required before the failure probe",
      );
      // A real rejected nested route qualifies failure interpretation without changing the baseline.
      await multisig(
        "probe-unauthorized-M1",
        m1,
        [actors.A, actors.B, actors.D],
        ["A", "D"],
        throughP(session.p, { kind: "remove-proxy", delegate: m0 }),
        true,
      );
      await proxySet(session.p, [m0]);
    }
    if (action === "seed" && !session.steps["cancel-probe-cancel"]?.receipt) {
      requireCondition(
        session.p && session.baseline,
        "Seed baseline is required before cancellation probe",
      );
      const inner = throughP(session.p, { kind: "map-account" });
      const innerTx = connection.transaction(inner);
      const callHash = blake2AsHex(innerTx.callHex);
      const weight = await connection.dispatchWeight(innerTx);
      if (!session.cancellationProbe) {
        session.cancellationProbe = {
          reservedBefore: (
            await connection.readAccount(actors.A)
          ).reserved.toString(),
          callHash,
        };
        save(sessionPath, session);
      }
      requireCondition(
        session.cancellationProbe.callHash === callHash,
        "Cancellation probe preimage changed",
      );
      const first = await transact(
        "cancel-probe-open",
        {
          kind: "multisig",
          threshold: 2,
          others: [actors.B, actors.C].sort(),
          timepoint: undefined,
          inner,
          weight,
        },
        "A",
      );
      requireCondition(
        !first.businessExecuted,
        "A first approval unexpectedly executed the cancellation probe",
      );
      const proposal = await connection.proposal(m0, callHash);
      requireCondition(
        proposal && proposal.depositor === actors.A,
        "Cancellation must use the actual original depositor",
      );
      const reserved = (await connection.readAccount(actors.A)).reserved;
      requireCondition(
        reserved ===
          BigInt(session.cancellationProbe.reservedBefore) + proposal.deposit,
        "First approval deposit was not attributed to its depositor",
      );
      const cancelled = await transact(
        "cancel-probe-cancel",
        {
          kind: "cancel",
          threshold: 2,
          others: [actors.B, actors.C].sort(),
          timepoint: proposal.when,
          callHash,
        },
        "A",
      );
      requireCondition(
        (await connection.proposal(m0, callHash, cancelled.blockHash)) === null,
        "Cancelled proposal still exists at finality",
      );
      requireCondition(
        (await connection.readAccount(actors.A)).reserved ===
          BigInt(session.cancellationProbe.reservedBefore),
        "Cancellation did not return the exact proposal deposit",
      );
      await proxySet(session.p, [m0]);
    }
    if (action === "handoff" || action === "negative") {
      requireCondition(
        session.p && session.grantId && session.baseline,
        "Seed the full vested grant baseline first",
      );
      const p = session.p;
      const grantId = BigInt(session.grantId);
      if (action === "handoff") {
        const baselineRecord = session.baseline as {
          beneficiary: {
            reserved: bigint | string;
            proxyDeposit: bigint | string;
            holds: unknown;
            vesting: unknown;
          };
          controller: { reserved: bigint | string };
        };
        await multisig(
          "add-M1",
          m0,
          [actors.A, actors.B, actors.C],
          ["A", "B"],
          throughP(p, { kind: "add-proxy", delegate: m1 }),
        );
        if (!session.steps["remove-M0-D"]) {
          const dual = await proxySet(p, [m0, m1]);
          const increment =
            dual.proxyDeposit - BigInt(baselineRecord.beneficiary.proxyDeposit);
          requireCondition(
            increment > 0n &&
              dual.reserved ===
                BigInt(baselineRecord.beneficiary.reserved) + increment,
            "DualControl reserve increment does not match the exact added proxy",
          );
          requireCondition(
            JSON.stringify(plain(dual.holds)) ===
              JSON.stringify(baselineRecord.beneficiary.holds),
            "Mapping hold changed while adding the new controller",
          );
          session.dualControl = {
            beneficiary: dual,
            increment,
            fingerprint: await connection.fingerprint(),
          };
          save(sessionPath, session);
        }
        const removal = await multisig(
          "remove-M0",
          m1,
          [actors.A, actors.B, actors.D],
          ["A", "D"],
          throughP(p, { kind: "remove-proxy", delegate: m0 }),
        );
        const rotated = await proxySet(p, [m1]);
        requireCondition(
          rotated.mappedTo === p,
          "Pure mapping changed during rotation",
        );
        requireCondition(
          rotated.reserved === BigInt(baselineRecord.beneficiary.reserved) &&
            rotated.proxyDeposit ===
              BigInt(baselineRecord.beneficiary.proxyDeposit),
          "Exact old-controller removal did not restore the original reserve attribution",
        );
        requireCondition(
          JSON.stringify(plain(rotated.holds)) ===
            JSON.stringify(baselineRecord.beneficiary.holds),
          "Mapping hold changed during removal",
        );
        requireCondition(
          JSON.stringify(plain(rotated.vesting)) ===
            JSON.stringify(baselineRecord.beneficiary.vesting),
          "Native vesting tuple or multiplicity changed during rotation",
        );
        requireCondition(
          (await connection.readAccount(m0)).reserved ===
            BigInt(baselineRecord.controller.reserved),
          "Historical creator reserve changed during handoff",
        );
        session.rotation = {
          receipt: removal,
          beneficiary: rotated,
          fingerprint: await connection.fingerprint(),
        };
        save(sessionPath, session);
        const continuation = await multisig(
          "submit-m1",
          m1,
          [actors.A, actors.B, actors.D],
          ["A", "D"],
          async () =>
            throughP(
              p,
              await contractCall(
                p,
                encodeSubmission(
                  grantId,
                  1,
                  "LOCAL continuation by replacement controller A+D",
                ),
              ),
            ),
        );
        const submitted = event(continuation, "MilestoneSubmitted");
        requireCondition(
          String(submitted["grantId"]) === session.grantId &&
            String(submitted["index"]) === "1",
          "Continuation event belongs to a different grant/milestone",
        );
        const grant = await readGrant(
          connection,
          actors.F,
          session.contract,
          grantId,
        );
        requireCondition(
          grant.grantee.toLowerCase() === contractAddress(p) &&
            grant.milestones[1]?.state === 1,
          "Same-grant continuation poststate missing",
        );
        session.continuation = {
          receipt: continuation,
          grant: plain(grant),
          beneficiary: await proxySet(p, [m1]),
          fingerprint: await connection.fingerprint(),
        };
        save(sessionPath, session);
      } else {
        requireCondition(
          session.continuation,
          "Complete the distinct continuation proof before old-route negative testing",
        );
        const result = await multisig(
          "old-route-negative",
          m0,
          [actors.A, actors.B, actors.C],
          ["A", "B"],
          throughP(p, { kind: "remove-proxy", delegate: m1 }),
          true,
        );
        await proxySet(p, [m1]);
        requireCondition(
          result.outerSuccess && !result.nestedSuccess,
          "Old controller route was not rejected at the nested layer",
        );
        const original = session.baseline as {
          beneficiary: { vesting: unknown };
        };
        const before = await connection.readAccount(p);
        requireCondition(
          JSON.stringify(plain(before.vesting)) ===
            JSON.stringify(original.beneficiary.vesting),
          "Original vesting tuple changed before the optional post-proof refresh",
        );
        const historicalContinuation = JSON.stringify(
          plain(session.continuation),
        );
        const maintenance = await transact(
          "vest-other-after-proof",
          { kind: "vest-other", beneficiary: p },
          "A",
        );
        const after = await proxySet(p, [m1]);
        requireCondition(
          after.frozen <= before.frozen,
          "Vesting refresh unexpectedly increased the lock",
        );
        requireCondition(
          !maintenance.events.some(
            (item) =>
              item.pallet === "Revive" && item.name === "ContractEmitted",
          ),
          "Direct vesting refresh cannot supply a grant continuation event",
        );
        requireCondition(
          JSON.stringify(plain(session.continuation)) ===
            historicalContinuation,
          "Maintenance rewrote the historical continuation proof",
        );
        session.maintenance = {
          before,
          after,
          receipt: maintenance,
          completedAfterContinuation: true,
        };
        save(sessionPath, session);
      }
    }
    const workspace =
      session.p && session.grantId
        ? {
            format: "account-handoff-local-workspace",
            version: 1,
            mode: "LOCAL",
            runId: id,
            generation: run.generation,
            genesisHash: session.genesis,
            endpoint: run.nativeRpc,
            input: {
              name: `LOCAL ${id}`,
              oldMembers: [actors.A, actors.B, actors.C],
              newMembers: [actors.A, actors.B, actors.D],
              threshold: 2,
              funder: actors.F,
              reviewers: [actors.R1, actors.R2],
              beneficiary: session.p,
              contract: session.contract,
              grantId: session.grantId,
            },
            creation: session.steps["create-pure-B"]?.receipt
              ? {
                  transactionHash:
                    session.steps["create-pure-B"].receipt.txHash,
                  blockHash: session.steps["create-pure-B"].receipt.blockHash,
                  blockNumber:
                    session.steps["create-pure-B"].receipt.blockNumber,
                  transactionIndex:
                    session.steps["create-pure-B"].receipt.txIndex,
                }
              : null,
          }
        : null;
    if (workspace) save(join(directory, "workspace.json"), workspace);
    console.log(
      JSON.stringify(
        {
          status:
            action === "seed"
              ? "BASELINE_VERIFIED"
              : action === "handoff"
                ? "CONTINUED"
                : action === "negative"
                  ? "OLD_ROUTE_REJECTED"
                  : action === "reconcile"
                    ? "RECONCILED"
                    : "INSPECTED",
          runId: id,
          generation: run.generation,
          contract: session.contract,
          p: session.p,
          hP: session.p ? contractAddress(session.p) : null,
          m0,
          m1,
          grantId: session.grantId,
          completedSteps: Object.entries(session.steps)
            .filter(([, step]) => step.status === "finalized")
            .map(([name]) => name),
          evidence: `.local-state/${id}/seed.json`,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await connection.close();
    } finally {
      releaseLock();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
