import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import {
  assertGraphClosure,
  canonicalJson,
  type CallTree,
  type CanonicalRecord,
  type ChainProfile,
  type Controller,
  type FrozenEnvelope,
  type NativeProposal,
  type ReadAnchor,
} from "@account-handoff/contracts";
import {
  makeController,
  otherSignatories,
  planOperation,
} from "@account-handoff/domain";
import {
  encodeApproval,
  encodeCreateGrant,
  encodeSubmission,
} from "@account-handoff/grant-adapter";
import {
  account,
  contractAddress,
  hex,
  number,
  object,
  type Hex,
  type NativeAction,
  type NativeConnection,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { WorkspaceRecord } from "./models";
import { nativeActionFromTree } from "./record-builders";

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Imported evidence: ${message}`);
}
function text(value: unknown): string {
  requireValue(
    typeof value === "string",
    "an exact text parameter is missing.",
  );
  return value;
}
function derive(members: string[], role: "M0" | "M1"): Controller {
  return makeController(members, 2, role, {
    deriveMultisig: (keys, threshold) =>
      u8aToHex(createKeyMulti([...keys], threshold)),
  });
}
function sameController(
  left: Controller | null,
  right: Controller | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.account === right.account &&
        left.role === right.role &&
        left.threshold === right.threshold &&
        left.members.length === right.members.length &&
        left.members.every((member) => right.members.includes(member));
}
function executionTree(tree: CallTree): unknown {
  return {
    kind: tree.kind,
    palletOrContract: tree.palletOrContract,
    method: tree.method,
    parameters: tree.parameters,
    children: tree.children.map(executionTree),
  };
}
function encodeAbi(tree: CallTree): Hex {
  const p = object(tree.parameters);
  requireValue(
    tree.kind === "abi_call" && tree.palletOrContract === "VESTRY",
    "the ABI leaf is outside the supported contract.",
  );
  if (tree.method === "submitMilestone(uint256,uint256,string)")
    return encodeSubmission(
      BigInt(text(p["grantId"])),
      number(text(p["index"])),
      text(p["evidence"]),
    );
  if (tree.method === "approveMilestone(uint256,uint256)")
    return encodeApproval(BigInt(text(p["grantId"])), number(text(p["index"])));
  requireValue(
    tree.method ===
      "createGrant(address,address,address[],uint8,(uint128,uint64,uint32,address,bytes4,uint64)[])",
    "the ABI method is outside the supported authoring surface.",
  );
  requireValue(
    Array.isArray(p["reviewers"]) && Array.isArray(p["inputs"]),
    "grant creation arrays are missing.",
  );
  return encodeCreateGrant(
    hex(p["grantee"], 20),
    p["reviewers"].map((value) => hex(value, 20)),
    p["inputs"].map((value) => {
      const item = object(value);
      return {
        amount: BigInt(text(item["amount"])),
        deadline: BigInt(text(item["deadline"])),
        vestingBlocks: number(text(item["vestingBlocks"])),
        metricTarget: hex(item["metricTarget"], 20),
        metricSelector: hex(item["metricSelector"], 4),
        metricMin: BigInt(text(item["metricMin"])),
      };
    }),
  );
}

/** Reconstructs imported execution context; no uploaded status grants authority. */
export async function verifyWorkspaceEvidence(
  records: readonly CanonicalRecord[],
  w: WorkspaceRecord,
  connection: NativeConnection,
  current: NativeFingerprint,
): Promise<void> {
  assertGraphClosure(records);
  requireValue(
    current.genesis === w.genesis,
    "the selected network differs from the workspace.",
  );
  const byDigest = new Map(records.map((record) => [record.digest, record]));
  const byId = new Map(records.map((record) => [record.recordId, record]));
  const envelopes = records.filter(
    (record): record is FrozenEnvelope => record.kind === "FrozenEnvelope",
  );
  const proposals = records.filter(
    (record): record is NativeProposal => record.kind === "NativeProposal",
  );
  const fingerprints = new Map<string, Promise<NativeFingerprint>>();
  const pureStates = new Map<
    string,
    ReturnType<NativeConnection["readAccount"]>
  >();
  const historicalAnchors = new Map<string, Set<Hex>>();
  const contexts = new Map<string, { M0: Controller; M1: Controller | null }>();
  const actions = new Map<string, NativeAction>();
  const addAnchor = (controller: string, hash: string) => {
    const anchors = historicalAnchors.get(controller) ?? new Set<Hex>();
    anchors.add(hex(hash, 32));
    historicalAnchors.set(controller, anchors);
  };
  const fingerprint = (hash: string): Promise<NativeFingerprint> => {
    const block = hex(hash, 32);
    let pending = fingerprints.get(block);
    if (!pending) {
      pending = (async () => {
        const f = await connection.fingerprint(block);
        requireValue(
          f.genesis === w.genesis &&
            f.anchor.hash === block &&
            f.anchor.number <= current.anchor.number &&
            (await connection.api.rpc.chain_getBlockHash(f.anchor.number)) ===
              block,
          "a historical anchor is not canonical and finalized on this network.",
        );
        return f;
      })();
      fingerprints.set(block, pending);
    }
    return pending;
  };
  const anchor = async (value: ReadAnchor, profile?: ChainProfile) => {
    const f = await fingerprint(value.blockHash);
    requireValue(
      String(f.anchor.number) === value.blockNumber,
      "a historical block number differs from its canonical hash.",
    );
    for (const context of Object.values(value.contextBindings))
      requireValue(
        context.genesis === w.genesis &&
          context.runtimeCodeHash === f.runtimeCodeHash &&
          context.metadataSha256 === f.metadataSha256 &&
          context.specVersion === String(f.specVersion) &&
          context.transactionVersion === String(f.transactionVersion) &&
          context.metadataVersion === String(f.metadataVersion),
        "a historical runtime context differs from its independently read identity.",
      );
    if (profile) {
      requireValue(
        profile.genesis === w.genesis,
        "a profile belongs to another network.",
      );
      for (const [key, observed] of Object.entries({
        runtimeCodeHash: f.runtimeCodeHash,
        metadataSha256: f.metadataSha256,
        specVersion: String(f.specVersion),
        transactionVersion: String(f.transactionVersion),
        metadataVersion: String(f.metadataVersion),
      }))
        requireValue(
          profile[key as keyof ChainProfile] === null ||
            profile[key as keyof ChainProfile] === observed,
          "a profile differs from its historical runtime.",
        );
    }
  };
  for (const envelope of envelopes) {
    const p = envelope.participants;
    const M0 = derive([p.A, p.B, p.C], "M0");
    const M1 = p.D ? derive([p.A, p.B, p.D], "M1") : null;
    contexts.set(envelope.digest, { M0, M1 });
    addAnchor(M0.account, envelope.anchor.blockHash);
    if (M1) addAnchor(M1.account, envelope.anchor.blockHash);
  }
  // A former planned controller may first become a proxy at the add receipt,
  // after its envelope's review anchor. Use bound canonical evidence, not dates.
  for (const record of records) {
    if (record.kind === "ReceiptBundle") {
      const attempt = byId.get(record.signedAttemptId);
      const context =
        attempt?.kind === "SignedAttempt"
          ? contexts.get(attempt.envelopeDigest)
          : undefined;
      if (context) {
        addAnchor(context.M0.account, record.blockHash);
        if (context.M1) addAnchor(context.M1.account, record.blockHash);
      }
    }
    if (record.kind === "Snapshot" && record.pure === w.pure)
      for (const tuple of record.authority.tuples)
        addAnchor(tuple.delegate, record.anchor.blockHash);
    if (record.kind === "NativeProposal")
      addAnchor(record.multisig, record.anchor.blockHash);
    if (record.kind === "ContinuityCertificate")
      for (const controller of [record.M0, record.M1]) {
        addAnchor(controller.account, record.before.blockHash);
        addAnchor(controller.account, record.after.blockHash);
      }
  }
  for (const record of records) {
    if (record.kind === "ChainProfile")
      requireValue(
        record.genesis === w.genesis,
        "a profile belongs to another network.",
      );
    const profileDigest =
      record.kind === "FrozenEnvelope"
        ? record.intent.profileDigest
        : "profileDigest" in record
          ? record.profileDigest
          : null;
    const profile = profileDigest ? byDigest.get(profileDigest) : undefined;
    requireValue(
      !profileDigest || profile?.kind === "ChainProfile",
      "a runtime profile is missing.",
    );
    if ("anchor" in record && record.anchor)
      await anchor(
        record.anchor,
        profile?.kind === "ChainProfile" ? profile : undefined,
      );
    if (record.kind === "ContinuityCertificate") {
      requireValue(
        record.identity.P === w.pure &&
          record.identity.contractAddress === w.contract &&
          record.identity.grantId === w.grantId,
        "a continuity record belongs to another workspace.",
      );
      await anchor(
        record.before,
        profile?.kind === "ChainProfile" ? profile : undefined,
      );
      await anchor(
        record.after,
        profile?.kind === "ChainProfile" ? profile : undefined,
      );
    }
    if (record.kind === "Snapshot") {
      requireValue(
        record.pure === null || record.pure === w.pure,
        "a snapshot names another beneficiary.",
      );
      requireValue(
        record.grantScope.grantId === null ||
          record.grantScope.grantId === w.grantId,
        "a snapshot names another grant.",
      );
      if (record.accounting)
        requireValue(
          record.accounting.pure === w.pure &&
            record.accounting.creator === (w.creator?.account ?? w.M0.account),
          "accounting names another beneficiary or original creator.",
        );
      for (const mapping of record.mapping) {
        const expected =
          mapping.role === "P" ? w.pure : w.participants[mapping.role];
        requireValue(
          mapping.account === expected,
          "a mapping observation belongs to another participant.",
        );
      }
    }
  }
  const proven = new Map<string, Promise<void>>();
  const known = new Set(
    [w.M0.account, w.M1?.account, w.creator?.account].filter(
      (value): value is string => !!value,
    ),
  );
  const proveController = (controller: Controller): Promise<void> => {
    let pending = proven.get(controller.account);
    if (!pending) {
      pending = (async () => {
        if (known.has(controller.account)) return;
        requireValue(
          w.pure !== null,
          "a controller differs from this setup workspace.",
        );
        for (const block of historicalAnchors.get(controller.account) ?? []) {
          await fingerprint(block);
          let state = pureStates.get(block);
          if (!state) {
            state = connection.readAccount(w.pure, block);
            pureStates.set(block, state);
          }
          if (
            (await state).proxies.some(
              (proxy) =>
                proxy.delegate === controller.account &&
                proxy.proxyType === "Any" &&
                proxy.delay === 0,
            )
          )
            return;
        }
        throw new Error(
          "Imported evidence: a historical controller has no independently verified authority over this beneficiary.",
        );
      })();
      proven.set(controller.account, pending);
    }
    return pending;
  };
  for (const envelope of envelopes) {
    const p = envelope.participants;
    requireValue(
      p.F === w.participants.F &&
        p.R1 === w.participants.R1 &&
        p.R2 === w.participants.R2,
      "funder or reviewer roles differ from this workspace.",
    );
    const context = contexts.get(envelope.digest)!;
    await proveController(context.M0);
    if (context.M1) await proveController(context.M1);
    if (!w.pure)
      requireValue(
        ["A", "B", "C", "D"].every(
          (role) =>
            p[role as "A" | "B" | "C" | "D"] ===
            w.participants[role as "A" | "B" | "C" | "D"],
        ),
        "setup participant roles differ from this workspace.",
      );
    const parameters = envelope.intent.parameters;
    for (const key of ["pure", "targetPure"])
      if (typeof parameters[key] === "string")
        requireValue(
          account(parameters[key]) === w.pure,
          "an operation names another beneficiary.",
        );
    if (typeof parameters["contract"] === "string")
      requireValue(
        hex(parameters["contract"], 20) === w.contract,
        "an operation names another contract deployment.",
      );
    if (typeof parameters["grantId"] === "string")
      requireValue(
        parameters["grantId"] === w.grantId,
        "an operation names another grant.",
      );
    const grant = envelope.intent.expectedState.grantContext;
    requireValue(
      !grant || grant.grantId === w.grantId,
      "an expected grant context belongs to another workspace.",
    );
    if (envelope.intent.operationId === "GRC-GRANT-CREATE")
      requireValue(
        canonicalJson(parameters["reviewers"]) ===
          canonicalJson([contractAddress(p.R1), contractAddress(p.R2)]),
        "grant creation names different reviewers.",
      );
    if (envelope.intent.operationId === "GRC-MULTISIG-CANCEL") {
      const target = parameters["targetController"] as unknown as Controller;
      const derived = derive(target.members, target.role);
      requireValue(
        sameController(target, derived),
        "the cancellation controller does not derive from its members.",
      );
      requireValue(
        sameController(target, context.M0) ||
          sameController(target, context.M1),
        "the cancellation target differs from its declared controller roles.",
      );
      await proveController(derived);
    }
    const plan = planOperation(envelope.intent, {
      participants: p,
      ...context,
      pure: w.pure,
      resources: envelope.resources,
      sourceEvidence: envelope.callTree.sourceEvidence,
      encodeAbi,
      ...(w.pure ? { mappedPure: contractAddress(w.pure) } : {}),
      nativeToAbiRatio: 10000n,
    });
    requireValue(
      canonicalJson(executionTree(plan.callTree)) ===
        canonicalJson(executionTree(envelope.callTree)),
      "the call tree differs from its allowlisted intent.",
    );
    requireValue(
      plan.signingPath === envelope.signingPath &&
        sameController(plan.controller, envelope.controller) &&
        canonicalJson(plan.requiredSigners) ===
          canonicalJson(envelope.requiredSigners),
      "the controller or signing route differs from the derived intent.",
    );
    requireValue(
      plan.requiredSigners.includes(envelope.intent.authorActor),
      "the declared author has no role in this operation.",
    );
    const action = nativeActionFromTree(plan.callTree);
    const call = connection.transaction(action).callHex;
    if (envelope.innerRuntimeCallBytes !== null)
      requireValue(
        call === envelope.innerRuntimeCallBytes,
        "the native inner bytes differ from the reconstructed call.",
      );
    else
      requireValue(
        envelope.status === "draft",
        "a sealed envelope has no exact native inner bytes.",
      );
    if (envelope.innerRuntimeCallHash !== null)
      requireValue(
        blake2AsHex(call) === envelope.innerRuntimeCallHash,
        "the inner call hash differs from its reconstructed bytes.",
      );
    actions.set(envelope.digest, action);
  }
  for (const proposal of proposals) {
    const related = envelopes.filter(
      (envelope) =>
        envelope.intent.profileDigest === proposal.profileDigest &&
        ((envelope.controller?.account === proposal.multisig &&
          envelope.innerRuntimeCallHash === proposal.innerCallHash) ||
          (envelope.intent.operationId === "GRC-MULTISIG-CANCEL" &&
            (
              envelope.intent.parameters[
                "targetController"
              ] as unknown as Controller
            ).account === proposal.multisig &&
            envelope.intent.parameters["targetCallHash"] ===
              proposal.innerCallHash)),
    );
    requireValue(
      related.length > 0,
      "a native proposal has no associated workspace call preimage.",
    );
    const controller =
      related[0]!.controller ??
      (related[0]!.intent.parameters[
        "targetController"
      ] as unknown as Controller);
    requireValue(
      proposal.approvals.every((signer) =>
        controller.members.includes(signer),
      ) &&
        (proposal.depositor === null ||
          controller.members.includes(proposal.depositor)),
      "proposal approvers or depositor differ from its controller.",
    );
  }
  for (const record of records) {
    if (record.kind !== "SignedAttempt") continue;
    const envelope = byDigest.get(record.envelopeDigest);
    requireValue(
      envelope?.kind === "FrozenEnvelope",
      "an attempt has no exact envelope.",
    );
    const context = record.reviewedSigningContext;
    requireValue(
      context.genesis === w.genesis && context.signer === record.signer,
      "a signing context belongs to another network or signer.",
    );
    const f = await fingerprint(envelope.anchor.blockHash);
    requireValue(
      context.runtimeCodeHash === f.runtimeCodeHash &&
        context.metadataSha256 === f.metadataSha256 &&
        context.specVersion === String(f.specVersion) &&
        context.transactionVersion === String(f.transactionVersion),
      "a signing context differs from its historical runtime.",
    );
    const phase = context.operationPhase;
    let action = actions.get(envelope.digest)!;
    if (envelope.controller) {
      requireValue(
        phase === "multisig_first" || phase === "multisig_final",
        "a multisig attempt has a different signing phase.",
      );
      requireValue(
        record.signer ===
          envelope.requiredSigners[phase === "multisig_first" ? 0 : 1],
        "a multisig attempt does not use its designated phase signer.",
      );
      const proposal = context.nativeProposalDigest
        ? byDigest.get(context.nativeProposalDigest)
        : null;
      if (phase === "multisig_final")
        requireValue(
          proposal?.kind === "NativeProposal" &&
            proposal.profileDigest === envelope.intent.profileDigest &&
            proposal.multisig === envelope.controller.account &&
            proposal.innerCallHash === envelope.innerRuntimeCallHash &&
            proposal.timepoint !== null &&
            proposal.timepoint.clockDomain === "native-block-number" &&
            proposal.state === "present" &&
            proposal.depositor === envelope.requiredSigners[0] &&
            proposal.approvals.length === 1 &&
            proposal.approvals[0] === envelope.requiredSigners[0],
          "a final approval has no matching proposal incarnation.",
        );
      else
        requireValue(
          proposal === null,
          "a first approval unexpectedly reuses a native proposal.",
        );
      const weight = envelope.resources.multisigInnerMaxWeight;
      requireValue(weight !== null, "multisig execution weight is missing.");
      action = {
        kind: "multisig",
        threshold: 2,
        others: otherSignatories(envelope.controller, record.signer),
        timepoint:
          proposal?.kind === "NativeProposal" && proposal.timepoint
            ? {
                height: number(proposal.timepoint.height),
                index: number(proposal.timepoint.index),
              }
            : undefined,
        inner: action,
        weight: {
          refTime: BigInt(weight.refTime),
          proofSize: BigInt(weight.proofSize),
        },
      };
    } else {
      requireValue(
        phase ===
          (envelope.intent.operationId === "GRC-MULTISIG-CANCEL"
            ? "cancel"
            : "direct"),
        "a direct attempt has a different signing phase.",
      );
      requireValue(
        context.nativeProposalDigest === null,
        "a direct attempt unexpectedly reuses a native proposal.",
      );
    }
    requireValue(
      connection.transaction(action).callHex === context.outerCallBytes,
      "the signed outer call differs from the exact reconstructed operation.",
    );
  }
}
