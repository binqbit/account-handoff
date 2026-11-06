import { blake2AsHex } from "dedot/utils";
import type {
  CanonicalRecord,
  FrozenEnvelope,
  SignedAttempt,
} from "@account-handoff/contracts";
import {
  account,
  hex,
  type NativeConnection,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import type { WorkspaceInput, RuntimeMode } from "../ui-contract";
import type { WorkspaceRecord } from "./models";
import type { NetworkDescriptor } from "./network-descriptor";
import { createWorkspaceRecord } from "./workspace-state";
import { verifyWorkspaceConnection } from "./local-import";
import { id, schedules } from "./values";
import { hasPreservedSchedule } from "@account-handoff/domain";
import {
  validateWorkspaceDescriptor,
  type WorkspaceDescriptor,
  type WorkspaceImportDraft,
} from "./workspace-package";

export function descriptorInput(
  w: WorkspaceImportDraft,
): Partial<WorkspaceInput> {
  const roles = w.participants;
  return {
    ...(w.name ? { name: w.name } : {}),
    ...(w.M0
      ? {
          oldMembers:
            roles?.A && roles.B && roles.C
              ? [roles.A, roles.B, roles.C]
              : w.M0.members,
          threshold: w.M0.threshold,
        }
      : {}),
    ...(w.M1 ? { newMembers: w.M1.members } : {}),
    ...(roles?.F ? { funder: roles.F } : {}),
    ...(roles?.R1 && roles.R2 ? { reviewers: [roles.R1, roles.R2] } : {}),
    ...(w.pure ? { beneficiary: w.pure } : {}),
    ...(w.contract ? { contract: w.contract } : {}),
    ...(w.grantId !== undefined && w.grantId !== null
      ? { grantId: w.grantId }
      : {}),
    ...(w.creation ? { creation: w.creation } : {}),
  };
}

export function completeDescriptor(
  draft: WorkspaceImportDraft,
  input: WorkspaceInput,
  mode: RuntimeMode,
  genesis: string,
): WorkspaceDescriptor {
  if (draft.pure === undefined && input.beneficiary === undefined)
    throw new Error(
      "Confirm whether this workspace already has a beneficiary.",
    );
  if (draft.contract === undefined && input.contract === undefined)
    throw new Error("Confirm whether this workspace already has a grant.");
  if (draft.M1 === undefined && input.newMembers === undefined)
    throw new Error("Confirm whether a replacement group is already planned.");
  const w = createWorkspaceRecord(input, mode, hex(genesis, 32));
  return validateWorkspaceDescriptor({
    name: w.name,
    mode,
    genesis: w.genesis,
    M0: { members: w.M0.members, threshold: 2 },
    M1: w.M1 ? { members: w.M1.members, threshold: 2 } : null,
    participants: {
      A: w.participants.A,
      B: w.participants.B,
      C: w.participants.C,
      D: w.participants.D,
      F: w.participants.F,
      R1: w.participants.R1,
      R2: w.participants.R2,
    },
    pure: w.pure,
    contract: w.contract,
    grantId: w.grantId,
    creation: input.creation ?? draft.creation ?? null,
    baselineBlockHash: draft.baselineBlockHash ?? null,
    handoffBaselineBlockHash: draft.handoffBaselineBlockHash ?? null,
  });
}

/** Every explicit scope is checked before any record can enter a local journal. */
export function assertWorkspaceEvidence(
  records: readonly CanonicalRecord[],
  w: Pick<WorkspaceRecord, "genesis" | "pure" | "contract" | "grantId">,
): void {
  const mismatch = () => {
    throw new Error(
      "This package belongs to a different workspace. Check its network, beneficiary, contract and grant.",
    );
  };
  for (const record of records) {
    if (record.kind === "ChainProfile" && record.genesis !== w.genesis)
      mismatch();
    if (
      "anchor" in record &&
      record.anchor &&
      Object.values(record.anchor.contextBindings).some(
        (binding) => binding.genesis !== w.genesis,
      )
    )
      mismatch();
    if (record.kind === "Snapshot") {
      if (record.pure !== null && record.pure !== w.pure) mismatch();
      if (
        record.grantScope.grantId !== null &&
        record.grantScope.grantId !== w.grantId
      )
        mismatch();
    }
    if (record.kind === "FrozenEnvelope") {
      const context = record.intent.expectedState.grantContext;
      if (context && context.grantId !== w.grantId) mismatch();
      const pure = record.intent.parameters["pure"];
      if (typeof pure === "string" && account(pure) !== w.pure) mismatch();
      const targetPure = record.intent.parameters["targetPure"];
      if (typeof targetPure === "string" && account(targetPure) !== w.pure)
        mismatch();
      const contract = record.intent.parameters["contract"];
      if (
        w.contract !== null &&
        typeof contract === "string" &&
        hex(contract, 20) !== w.contract
      )
        mismatch();
      const grantId = record.intent.parameters["grantId"];
      if (typeof grantId === "string" && grantId !== w.grantId) mismatch();
    }
    if (
      record.kind === "SignedAttempt" &&
      record.reviewedSigningContext.genesis !== w.genesis
    )
      mismatch();
    if (
      record.kind === "ContinuityCertificate" &&
      (record.identity.P !== w.pure ||
        record.identity.contractAddress !== w.contract ||
        record.identity.grantId !== w.grantId)
    )
      mismatch();
  }
}

export function sameWorkspace(
  w: Pick<
    WorkspaceRecord,
    "genesis" | "pure" | "contract" | "grantId" | "M0" | "participants"
  >,
  d: WorkspaceImportDraft,
): boolean {
  if (!d.genesis || d.genesis !== w.genesis) return false;
  if (d.pure)
    return (
      d.pure === w.pure &&
      (!d.contract || d.contract === w.contract) &&
      (d.grantId === undefined || d.grantId === null || d.grantId === w.grantId)
    );
  return (
    !!d.M0 &&
    w.pure === null &&
    d.M0.members.length === w.M0.members.length &&
    d.M0.members.every((member) => w.M0.members.includes(member)) &&
    (!d.participants ||
      Object.entries(d.participants).every(
        ([role, address]) =>
          w.participants[role as keyof WorkspaceRecord["participants"]] ===
          address,
      ))
  );
}

export function sameWorkspaceConfiguration(
  w: WorkspaceRecord,
  d: WorkspaceDescriptor,
): boolean {
  return (
    sameWorkspace(w, d) &&
    w.M0.members.length === d.M0.members.length &&
    w.M0.members.every((m) => d.M0.members.includes(m)) &&
    !!w.M1 === !!d.M1 &&
    (!w.M1 || w.M1.members.every((m) => d.M1!.members.includes(m))) &&
    Object.entries(d.participants).every(
      ([role, address]) =>
        w.participants[role as keyof WorkspaceRecord["participants"]] ===
        address,
    ) &&
    w.contract === d.contract &&
    w.grantId === d.grantId
  );
}

/** Build local configuration using independently verified provenance and observations. */
export async function restoreWorkspaceCandidate(
  d: WorkspaceDescriptor,
  records: readonly CanonicalRecord[],
  connection: NativeConnection,
  expected: NetworkDescriptor | null,
  current: NativeFingerprint,
): Promise<WorkspaceRecord> {
  if (d.genesis !== current.genesis || d.mode !== connection.mode)
    throw new Error(
      "Connect to the package's matching network before restoring this workspace.",
    );
  const input = descriptorInput(d) as WorkspaceInput;
  const w = createWorkspaceRecord(input, d.mode, d.genesis);
  assertWorkspaceEvidence(records, w);
  if (w.pure) {
    if (!expected || !d.creation)
      throw new Error(
        "A qualified network and Pure creation locator are required to restore this beneficiary.",
      );
    const proof = await verifyWorkspaceConnection(
      input,
      d.creation,
      connection,
      expected,
      d.M1?.members,
    );
    w.creator = proof.creator;
    w.creationEvidence = proof.creationEvidence;
    w.creationBlock = proof.creationBlock;
  }
  return w;
}

/** Original release state is discovered from complete chain history, never a file's chosen checkpoint. */
export async function restoreCheckpointHints(
  w: WorkspaceRecord,
  d: WorkspaceDescriptor,
  connection: NativeConnection,
  current: NativeFingerprint,
): Promise<void> {
  async function checkpoint(
    blockHash: string,
  ): Promise<NonNullable<WorkspaceRecord["baseline"]>> {
    if (!w.pure || !w.contract || w.grantId === null)
      throw new Error(
        "Historical grant checkpoints require a beneficiary and grant binding.",
      );
    const f = await connection.fingerprint(hex(blockHash, 32));
    if (
      f.genesis !== w.genesis ||
      f.anchor.number > current.anchor.number ||
      (w.creationBlock !== undefined && f.anchor.number < w.creationBlock) ||
      (await connection.api.rpc.chain_getBlockHash(f.anchor.number)) !==
        blockHash
    )
      throw new Error(
        "The imported checkpoint is not a canonical finalized block for this workspace.",
      );
    const [pure, creator, grant] = await Promise.all([
      connection.readAccount(w.pure, f.anchor.hash),
      connection.readAccount(w.creator?.account ?? w.M0.account, f.anchor.hash),
      readGrant(
        connection,
        w.pure,
        w.contract,
        BigInt(w.grantId),
        f.anchor.hash,
      ),
    ]);
    return {
      account: pure,
      grant,
      blockHash: f.anchor.hash,
      creatorReserved: String(creator.reserved),
    };
  }
  if (d.baselineBlockHash && d.baselineBlockHash !== w.baseline?.blockHash)
    throw new Error(
      "The package's original vesting checkpoint differs from the grant's verified first release.",
    );
  if (!d.handoffBaselineBlockHash) return;
  if (!w.M1 || !w.baseline)
    throw new Error(
      "A handoff checkpoint requires a planned replacement and the original verified vesting release.",
    );
  const restored = await checkpoint(d.handoffBaselineBlockHash);
  const first = await connection.fingerprint(w.baseline.blockHash);
  const handoff = await connection.fingerprint(restored.blockHash);
  if (
    handoff.anchor.number < first.anchor.number ||
    restored.account.proxies.length !== 1 ||
    restored.account.proxies[0]!.delegate !== w.M0.account ||
    restored.account.proxies[0]!.proxyType !== "Any" ||
    restored.account.proxies[0]!.delay !== 0 ||
    !hasPreservedSchedule(
      schedules(w.baseline.account.vesting),
      schedules(restored.account.vesting),
    )
  )
    throw new Error(
      "The handoff checkpoint does not preserve the original grant schedule under its old controller.",
    );
  w.handoffBaseline = restored;
}

export async function restoreWorkspaceHistory(
  w: WorkspaceRecord,
  records: readonly CanonicalRecord[],
  connection: NativeConnection,
  current: NativeFingerprint,
  handoffBaselineBlockHash: string | null,
): Promise<void> {
  const envelopes = new Map(
    records
      .filter((r): r is FrozenEnvelope => r.kind === "FrozenEnvelope")
      .map((r) => [r.digest, r]),
  );
  const attempts = new Map(
    records
      .filter((r): r is SignedAttempt => r.kind === "SignedAttempt")
      .map((r) => [r.recordId, r]),
  );
  const seen = new Set<string>(w.history.map((row) => row.receipt.txHash));
  const handoffStart = handoffBaselineBlockHash
    ? (await connection.fingerprint(hex(handoffBaselineBlockHash, 32))).anchor
        .number
    : 0;
  for (const record of records) {
    if (record.kind !== "ReceiptBundle") continue;
    const attempt = attempts.get(record.signedAttemptId);
    const envelope = attempt
      ? envelopes.get(attempt.envelopeDigest)
      : undefined;
    if (
      !attempt ||
      !envelope ||
      record.intentId !== envelope.intent.intentId ||
      attempt.intentId !== envelope.intent.intentId ||
      record.operationId !== envelope.intent.operationId ||
      record.operationPhase !== attempt.reviewedSigningContext.operationPhase
    )
      throw new Error(
        "Imported history has inconsistent operation or intent bindings.",
      );
    const f = await connection.fingerprint(hex(record.blockHash, 32));
    if (
      f.anchor.number > current.anchor.number ||
      (await connection.api.rpc.chain_getBlockHash(f.anchor.number)) !==
        record.blockHash
    )
      throw new Error("Imported history is not canonical and finalized.");
    const receipt = await connection.receiptAt(
      hex(record.blockHash, 32),
      hex(record.extrinsicHash, 32),
    );
    const extrinsic = await connection.inspectExtrinsic(
      receipt.blockHash,
      receipt.txIndex,
    );
    if (
      receipt.blockHash !== record.blockHash ||
      receipt.txHash !== record.extrinsicHash ||
      String(receipt.txIndex) !== record.extrinsicIndex ||
      extrinsic.signer !== attempt.signer ||
      blake2AsHex(extrinsic.callHex) !==
        attempt.reviewedSigningContext.outerCallHash ||
      extrinsic.callHex !== attempt.reviewedSigningContext.outerCallBytes
    )
      throw new Error(
        "Imported history differs from its actual native transaction.",
      );
    // A familiar hash cannot validate a new claim about the transaction.
    // Deduplicate only after independently checking every incoming receipt.
    if (seen.has(record.extrinsicHash)) continue;
    seen.add(record.extrinsicHash);
    const relevantController =
      !envelope.controller ||
      envelope.controller.account === w.M0.account ||
      envelope.controller.account === w.M1?.account;
    const timestamp = Number(
      await connection.currentBlockTime(receipt.blockHash),
    );
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      timestamp > 8_640_000_000_000_000
    )
      throw new Error("The historical transaction timestamp is unavailable.");
    w.history.push({
      id: id(),
      operationId: record.operationId,
      title: envelope.summaryText,
      at: new Date(timestamp).toISOString(),
      signer: attempt.signer,
      receipt,
      envelopeDigest: envelope.digest,
      attemptId: attempt.recordId,
      grantId: w.grantId,
      handoffId:
        relevantController && receipt.blockNumber >= handoffStart
          ? (w.handoffId ?? "initial")
          : "imported-history",
    });
  }
  w.history.sort(
    (a, b) =>
      a.receipt.blockNumber - b.receipt.blockNumber ||
      a.receipt.txIndex - b.receipt.txIndex,
  );
}
