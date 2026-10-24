import {
  canonicalJson,
  createSnapshot,
  hexBytes,
  sha256,
  validateRecordSemantics,
} from "@account-handoff/contracts";
import type {
  AccountingLedger,
  CanonicalRecord,
  ContinuityCertificate,
  DataValue,
  EvidenceRef,
  FrozenEnvelope,
  GrantFlowScope,
  NativeProposal,
  ReceiptBundle,
  SignedAttempt,
  Snapshot,
  VestingTuple,
} from "@account-handoff/contracts";
import {
  assessBacking,
  classifyAuthority,
  hasPreservedSchedule,
  vestingRemaining,
} from "@account-handoff/domain";
import { issueContinuityCertificate } from "@account-handoff/evidence";
import {
  account,
  contractAddress,
  hex,
  plain,
} from "@account-handoff/native-adapter";
import type {
  Hex,
  NativeAccountState,
  NativeConnection,
  NativeFingerprint,
  NativeReceipt,
} from "@account-handoff/native-adapter";
import { reduceGrantHistory } from "@account-handoff/grant-adapter";
import type { GrantHistory, GrantState } from "@account-handoff/grant-adapter";
import { blake2AsHex } from "dedot/utils";
import type { WorkspaceRecord } from "./models";
import { buildReadAnchor, buildReceipt } from "./record-builders";

interface InspectedExtrinsic {
  bytes: Hex;
  signer: string | null;
  call: unknown;
  callHex: Hex;
}
interface EvidenceConnection {
  api: NativeConnection["api"];
  readAccount(address: string, blockHash?: Hex): Promise<NativeAccountState>;
  receiptAt(blockHash: Hex, transactionHash: Hex): Promise<NativeReceipt>;
  inspectExtrinsic(blockHash: Hex, index: number): Promise<InspectedExtrinsic>;
}
export interface WorkspaceCertificateInput {
  connection: EvidenceConnection;
  workspace: WorkspaceRecord;
  profile: Extract<CanonicalRecord, { kind: "ChainProfile" }>;
  beforeFingerprint: NativeFingerprint;
  afterFingerprint: NativeFingerprint;
  currentAccounts: Record<string, NativeAccountState>;
  currentGrant: GrantState;
  accounting: AccountingLedger;
  history: GrantHistory;
  records: CanonicalRecord[];
  verifiedReceipts?: Array<{ receipt: NativeReceipt; rawExtrinsic: Hex }>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected exact structured chain evidence");
  return value as Record<string, unknown>;
}
function bigint(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    return BigInt(value);
  throw new Error("Invalid exact native quantity");
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text identity");
  return value;
}
function field(
  object: Record<string, unknown>,
  camel: string,
  snake: string,
): unknown {
  return object[camel] ?? object[snake];
}
function schedules(value: unknown): VestingTuple[] {
  if (value === null) return [];
  if (!Array.isArray(value))
    throw new Error("Vesting observation is unavailable");
  return value.map((item) => {
    const raw = object(item);
    return {
      locked: bigint(raw.locked).toString(),
      perBlock: bigint(field(raw, "perBlock", "per_block")).toString(),
      startingBlock: bigint(
        field(raw, "startingBlock", "starting_block"),
      ).toString(),
      clockDomain: "native-block-number",
    };
  });
}
function liabilities(
  value: unknown,
  evidence: EvidenceRef[],
): AccountingLedger["pureReasonHolds"] {
  if (!Array.isArray(value))
    throw new Error("Hold or reserve observations are unavailable");
  return value.map((item) => {
    const raw = object(item);
    return {
      reason: canonicalJson(plain(raw.id)),
      amountNative: bigint(raw.amount).toString(),
      evidence,
    };
  });
}
function tupleIdentity(tuple: VestingTuple): string {
  return `${tuple.locked}:${tuple.perBlock}:${tuple.startingBlock}:${tuple.clockDomain}`;
}
function eventProjection(receipt: ReceiptBundle): unknown {
  return receipt.events.map(({ rawEvidence: _raw, ...event }) => event);
}
function callParts(value: unknown): {
  pallet: string;
  name: string;
  params: Record<string, unknown>;
} {
  const call = object(value);
  const inner = object(call.palletCall);
  return {
    pallet: text(call.pallet),
    name: text(inner.name),
    params: object(inner.params),
  };
}
function roleAddress(value: unknown): string {
  if (typeof value === "string") return account(value);
  const address = object(value);
  if (address.type === "Id") return roleAddress(address.value);
  if (typeof address.raw === "string") return account(address.raw);
  throw new Error(
    "Proof requires a canonical native AccountId32, not an unresolved address index",
  );
}

export function inspectM1ProofRoute(
  inspection: InspectedExtrinsic,
  envelope: FrozenEnvelope,
  w: WorkspaceRecord,
  first: boolean,
): unknown {
  const expectedSigner = first ? w.participants.A : w.participants.D;
  if (inspection.signer !== expectedSigner)
    throw new Error("Unexpected participant in M1 route");
  const outer = callParts(inspection.call);
  if (
    outer.pallet !== "Multisig" ||
    outer.name !== "AsMulti" ||
    bigint(outer.params.threshold) !== 2n ||
    !Array.isArray(outer.params.otherSignatories)
  )
    throw new Error("Expected full-call 2-of-3 Multisig.as_multi");
  const others = outer.params.otherSignatories.map(roleAddress).sort();
  const expectedOthers = w.M1.members
    .filter((member) => member !== expectedSigner)
    .sort();
  if (canonicalJson(others) !== canonicalJson(expectedOthers))
    throw new Error("M1 multisig membership differs");
  const proxy = callParts(outer.params.call);
  if (
    proxy.pallet !== "Proxy" ||
    proxy.name !== "Proxy" ||
    roleAddress(proxy.params.real) !== w.pure ||
    proxy.params.forceProxyType !== "Any"
  )
    throw new Error(
      "Expected M1 proxy dispatch through the unchanged beneficiary",
    );
  const leaf = callParts(proxy.params.call);
  if (envelope.intent.operationId === "GRC-ROTATION-REMOVE-M0") {
    if (
      leaf.pallet !== "Proxy" ||
      leaf.name !== "RemoveProxy" ||
      roleAddress(leaf.params.delegate) !== w.M0.account ||
      leaf.params.proxyType !== "Any" ||
      bigint(leaf.params.delay) !== 0n
    )
      throw new Error("Expected exact old-controller tuple removal");
  } else {
    if (
      leaf.pallet !== "Revive" ||
      leaf.name !== "Call" ||
      text(leaf.params.dest).toLowerCase() !== w.contract ||
      bigint(leaf.params.value) !== 0n
    )
      throw new Error("Expected zero-value continuation on the same contract");
    const reviveNode = envelope.callTree.children[0];
    if (
      !reviveNode ||
      reviveNode.method !== "call" ||
      text(leaf.params.data) !== text(object(reviveNode.parameters).data)
    )
      throw new Error(
        "Continuation ABI bytes differ from the reviewed envelope",
      );
  }
  return outer.params.call;
}

interface ReceiptProof {
  receipt: ReceiptBundle;
  envelope: FrozenEnvelope;
  attempt: SignedAttempt;
  proposal: NativeProposal;
  participation: EvidenceRef[];
}

async function proveReceipt(
  input: WorkspaceCertificateInput,
  candidate: ReceiptBundle,
  baselineAccount: NativeAccountState,
): Promise<ReceiptProof | null> {
  const { connection, workspace: w, records } = input;
  if (
    !candidate.anchor ||
    candidate.profileDigest !== input.profile.digest ||
    candidate.operationPhase !== "multisig_final" ||
    candidate.businessEffect !== "historically_verified" ||
    candidate.status !== "finalized_success"
  )
    return null;
  const attempt = records.find(
    (record): record is SignedAttempt =>
      record.kind === "SignedAttempt" &&
      record.recordId === candidate.signedAttemptId,
  );
  const envelope =
    attempt &&
    records.find(
      (record): record is FrozenEnvelope =>
        record.kind === "FrozenEnvelope" &&
        record.digest === attempt.envelopeDigest,
    );
  const proposal =
    attempt &&
    records.find(
      (record): record is NativeProposal =>
        record.kind === "NativeProposal" &&
        record.digest === attempt.reviewedSigningContext.nativeProposalDigest,
    );
  if (
    !attempt ||
    !envelope ||
    !proposal ||
    proposal.timepoint === null ||
    proposal.state !== "present" ||
    proposal.depositor !== w.participants.A ||
    proposal.approvals.length !== 1 ||
    proposal.approvals[0] !== w.participants.A ||
    proposal.multisig !== w.M1.account ||
    proposal.innerCallHash !== envelope.innerRuntimeCallHash ||
    attempt.signer !== w.participants.D ||
    attempt.reviewedSigningContext.operationPhase !== "multisig_final" ||
    envelope.controller?.account !== w.M1.account ||
    canonicalJson(envelope.requiredSigners) !==
      canonicalJson([w.participants.A, w.participants.D])
  )
    return null;
  if (
    (
      await Promise.all(
        [candidate, attempt, envelope, proposal].map(validateRecordSemantics),
      )
    ).some((issues) => issues.length > 0)
  )
    return null;
  const finalNative =
    input.verifiedReceipts?.find(
      (entry) =>
        entry.receipt.txHash === candidate.extrinsicHash &&
        entry.receipt.blockHash === candidate.blockHash,
    )?.receipt ??
    (await connection.receiptAt(
      hex(candidate.blockHash, 32),
      hex(candidate.extrinsicHash, 32),
    ));
  if (
    !finalNative.nestedSuccess ||
    !finalNative.businessExecuted ||
    String(finalNative.txIndex) !== candidate.extrinsicIndex
  )
    return null;
  const finalInspection = await connection.inspectExtrinsic(
    hex(candidate.blockHash, 32),
    Number(candidate.extrinsicIndex),
  );
  if (
    blake2AsHex(finalInspection.bytes) !== candidate.extrinsicHash ||
    finalInspection.callHex !== attempt.reviewedSigningContext.outerCallBytes ||
    finalInspection.callHex === "0x"
  )
    return null;
  if (
    attempt.signedExtrinsicBytes !== null &&
    finalInspection.bytes !== attempt.signedExtrinsicBytes
  )
    return null;
  const finalInner = inspectM1ProofRoute(finalInspection, envelope, w, false);
  const firstHeight = Number(proposal.timepoint.height),
    firstIndex = Number(proposal.timepoint.index);
  if (
    !Number.isSafeInteger(firstHeight) ||
    !Number.isSafeInteger(firstIndex) ||
    firstHeight > finalNative.blockNumber
  )
    return null;
  const firstHash = await connection.api.rpc.chain_getBlockHash(firstHeight);
  if (!firstHash) return null;
  const firstInspection = await connection.inspectExtrinsic(
    hex(firstHash, 32),
    firstIndex,
  );
  const firstNative = await connection.receiptAt(
    hex(firstHash, 32),
    blake2AsHex(firstInspection.bytes),
  );
  if (!firstNative.outerSuccess || firstNative.businessExecuted) return null;
  const firstInner = inspectM1ProofRoute(firstInspection, envelope, w, true);
  if (canonicalJson(plain(firstInner)) !== canonicalJson(plain(finalInner)))
    return null;
  const start = firstNative.events.find(
    (event) => event.pallet === "Multisig" && event.name === "NewMultisig",
  );
  const complete = finalNative.events.find(
    (event) => event.pallet === "Multisig" && event.name === "MultisigExecuted",
  );
  if (
    !start ||
    !complete ||
    roleAddress(start.data.approving) !== w.participants.A ||
    roleAddress(start.data.multisig) !== w.M1.account ||
    field(start.data, "callHash", "call_hash") !==
      envelope.innerRuntimeCallHash ||
    roleAddress(complete.data.approving) !== w.participants.D ||
    roleAddress(complete.data.multisig) !== w.M1.account ||
    field(complete.data, "callHash", "call_hash") !==
      envelope.innerRuntimeCallHash
  )
    return null;
  const actualTimepoint = object(complete.data.timepoint);
  if (
    bigint(actualTimepoint.height).toString() !== proposal.timepoint.height ||
    bigint(actualTimepoint.index).toString() !== proposal.timepoint.index
  )
    return null;
  const checkpoint = await connection.readAccount(
    w.pure!,
    hex(candidate.blockHash, 32),
  );
  if (
    checkpoint.mappedTo !== w.pure ||
    checkpoint.proxies.length !== 1 ||
    checkpoint.proxies[0]!.delegate !== w.M1.account ||
    checkpoint.proxies[0]!.proxyType !== "Any" ||
    checkpoint.proxies[0]!.delay !== 0 ||
    checkpoint.proxyDeposit !== baselineAccount.proxyDeposit ||
    !hasPreservedSchedule(
      schedules(baselineAccount.vesting),
      schedules(checkpoint.vesting),
    )
  )
    return null;
  const checkpointLiabilities = [
    ...liabilities(checkpoint.holds, []),
    ...liabilities(checkpoint.namedReserves, []),
  ].reduce((sum, entry) => sum + BigInt(entry.amountNative), 0n);
  if (checkpoint.reserved !== checkpointLiabilities) return null;
  let actualRound: string | null = null;
  if (candidate.operationId === "GRC-GRANT-SUBMIT-M1") {
    const events = input.history.entries.filter(
      (entry) =>
        entry.eventName === "MilestoneSubmitted" &&
        entry.blockHash === candidate.blockHash &&
        String(entry.txIndex) === candidate.extrinsicIndex &&
        entry.grantId === w.grantId,
    );
    if (
      events.length !== 1 ||
      events[0]!.roundBefore !== 0 ||
      events[0]!.rawExtrinsic !== finalInspection.bytes
    )
      return null;
    actualRound = "0";
  }
  const recomputed = await buildReceipt(
    envelope,
    attempt,
    finalNative,
    candidate.anchor,
    "multisig_final",
    {
      postconditions: candidate.postconditions,
      ...(actualRound !== null ? { roundAtIntendedEvent: actualRound } : {}),
      orderedHistoryComplete: input.history.complete,
    },
  );
  if (
    recomputed.businessEffect !== "historically_verified" ||
    recomputed.status !== "finalized_success"
  )
    return null;
  if (
    canonicalJson(eventProjection(recomputed)) !==
    canonicalJson(eventProjection(candidate))
  )
    return null;
  const participation: EvidenceRef[] = [
    {
      kind: "native_chain",
      locator: `${firstHash}/${firstIndex}`,
      sourceId: firstNative.txHash,
      contentSha256: await sha256(hexBytes(firstInspection.callHex)),
    },
    {
      kind: "native_chain",
      locator: `${candidate.blockHash}/${candidate.extrinsicIndex}`,
      sourceId: candidate.extrinsicHash,
      contentSha256: await sha256(hexBytes(finalInspection.callHex)),
    },
  ];
  return { receipt: candidate, envelope, attempt, proposal, participation };
}

/** Builds a new certificate only after rereading both actual native approval/execution sequences. */
export async function buildWorkspaceCertificate(
  input: WorkspaceCertificateInput,
): Promise<{
  certificate: ContinuityCertificate;
  beforeSnapshot: Snapshot;
  afterSnapshot: Snapshot;
} | null> {
  try {
    const {
      workspace: w,
      profile,
      history,
      beforeFingerprint: before,
      afterFingerprint: after,
      accounting,
    } = input;
    if (
      !input.records.some(
        (record) =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-ROTATION-REMOVE-M0",
      ) ||
      !input.records.some(
        (record) =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-GRANT-SUBMIT-M1",
      )
    )
      return null;
    if (
      profile.status !== "accepted" ||
      !w.pure ||
      !w.contract ||
      w.grantId === null ||
      !w.baseline ||
      !w.creationEvidence.length ||
      w.baseline.creatorReserved === undefined ||
      !history.complete ||
      history.toBlock !== after.anchor.number ||
      history.scannedThrough !== after.anchor.number ||
      before.anchor.hash !== w.baseline.blockHash ||
      before.metadataSha256 !== profile.metadataSha256 ||
      after.metadataSha256 !== profile.metadataSha256 ||
      before.runtimeCodeHash !== after.runtimeCodeHash ||
      after.runtimeCodeHash !== profile.runtimeCodeHash
    )
      return null;
    const baselineAccount = await input.connection.readAccount(
      w.pure,
      hex(before.anchor.hash, 32),
    );
    const baselineCreator = await input.connection.readAccount(
      w.M0.account,
      hex(before.anchor.hash, 32),
    );
    if (String(baselineCreator.reserved) !== w.baseline.creatorReserved)
      return null;
    const current = input.currentAccounts[w.pure];
    if (
      !current ||
      current.address !== w.pure ||
      baselineAccount.address !== w.pure ||
      current.mappedTo !== w.pure ||
      baselineAccount.mappedTo !== w.pure ||
      input.currentGrant.grantee !== contractAddress(w.pure) ||
      w.baseline.grant.grantee !== input.currentGrant.grantee ||
      accounting.anchor.blockHash !== after.anchor.hash ||
      accounting.pure !== w.pure ||
      accounting.creator !== w.M0.account ||
      !assessBacking(accounting).backed
    )
      return null;
    if (
      current.proxies.some((p) => p.proxyType !== "Any" || p.delay !== 0) ||
      baselineAccount.proxies.some(
        (p) => p.proxyType !== "Any" || p.delay !== 0,
      )
    )
      return null;
    const currentTuples = current.proxies.map((p) => ({
      delegate: p.delegate,
      proxyType: "Any" as const,
      delay: "0" as const,
    }));
    const originalTuples = baselineAccount.proxies.map((p) => ({
      delegate: p.delegate,
      proxyType: "Any" as const,
      delay: "0" as const,
    }));
    if (
      classifyAuthority(currentTuples, w.M0.account, w.M1.account) !==
        "M1Only" ||
      classifyAuthority(originalTuples, w.M0.account, w.M1.account) !== "M0Only"
    )
      return null;
    const oldSchedules = schedules(baselineAccount.vesting),
      newSchedules = schedules(current.vesting);
    const tuple = oldSchedules.find(
      (entry) => vestingRemaining(entry, BigInt(before.anchor.number)) > 0n,
    );
    if (
      !tuple ||
      vestingRemaining(tuple, BigInt(after.anchor.number)) === 0n ||
      !hasPreservedSchedule(oldSchedules, newSchedules)
    )
      return null;
    const creation = history.entries.find(
      (entry) =>
        entry.eventName === "GrantCreated" && entry.grantId === w.grantId,
    );
    if (
      !creation ||
      text(creation.args.grantee).toLowerCase() !== contractAddress(w.pure) ||
      creation.blockNumber > before.anchor.number
    )
      return null;
    if (
      !history.firstVestingRelease ||
      history.firstVestingRelease.blockHash !== before.anchor.hash
    )
      return null;
    const creationMarker = w.creationEvidence.find(
      (entry) =>
        entry.kind === "native_chain" &&
        entry.sourceId &&
        /^0x[0-9a-f]{64}$/.test(entry.sourceId),
    );
    if (!creationMarker || !creationMarker.sourceId) return null;
    const pureBlock = creationMarker.locator.split("/")[0];
    if (!pureBlock || !/^0x[0-9a-f]{64}$/.test(pureBlock)) return null;
    const pureReceipt = await input.connection.receiptAt(
      hex(pureBlock, 32),
      hex(creationMarker.sourceId, 32),
    );
    const pureEvent = pureReceipt.events.find(
      (event) => event.pallet === "Proxy" && event.name === "PureCreated",
    );
    if (
      !pureReceipt.nestedSuccess ||
      !pureEvent ||
      roleAddress(pureEvent.data.pure) !== w.pure ||
      roleAddress(pureEvent.data.who) !== w.M0.account ||
      pureReceipt.blockNumber > creation.blockNumber ||
      (pureReceipt.blockNumber === creation.blockNumber &&
        creation.txIndex !== null &&
        pureReceipt.txIndex >= creation.txIndex)
    )
      return null;
    const pureCreationEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${pureReceipt.blockHash}/${pureReceipt.txIndex}`,
      sourceId: pureReceipt.txHash,
      contentSha256: await sha256(canonicalJson(plain(pureReceipt))),
    };

    const beforeAnchor = buildReadAnchor(profile, before),
      afterAnchor = buildReadAnchor(profile, after);
    const grantEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${creation.blockHash}/${creation.txIndex}/${creation.eventIndex}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(creation.args))),
    };
    const stateEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${after.anchor.hash}:state:${w.pure}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(current))),
    };
    const baseEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${before.anchor.hash}:state:${w.pure}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(baselineAccount))),
    };
    const beforeHolds = liabilities(baselineAccount.holds, [baseEvidence]);
    const beforeReserves = liabilities(baselineAccount.namedReserves, [
      baseEvidence,
    ]);
    const beforeLiabilities = [...beforeHolds, ...beforeReserves].reduce(
      (sum, entry) => sum + BigInt(entry.amountNative),
      0n,
    );
    if (
      baselineAccount.reserved !== beforeLiabilities ||
      baselineAccount.proxyDeposit !==
        BigInt(accounting.creatorHistoricalDepositNative) ||
      BigInt(w.baseline.creatorReserved) <
        BigInt(accounting.creatorHistoricalDepositNative)
    )
      return null;
    const beforeAccounting: AccountingLedger = {
      ...accounting,
      anchor: beforeAnchor,
      proxyDepositRecordedNative: String(baselineAccount.proxyDeposit),
      creatorCurrentAggregateReservedNative: w.baseline.creatorReserved,
      pureProxyIncrementNative: "0",
      pureFreeNative: String(baselineAccount.free),
      pureReservedNative: String(baselineAccount.reserved),
      pureFrozenNative: String(baselineAccount.frozen),
      pureReasonHolds: beforeHolds,
      pureNamedReserves: beforeReserves,
      pureOtherTracedReservedLiabilitiesNative: "0",
      pureBackedLiabilitiesNative: String(beforeLiabilities),
      unexplainedReservedDeltaNative: "0",
      adjustmentProvenance: [],
      creationProvenance: [pureCreationEvidence],
    };
    const priorEntries = structuredClone(
      history.entries.filter(
        (entry) => entry.blockNumber <= before.anchor.number,
      ),
    );
    const beforeScope = reduceGrantHistory(priorEntries, true, []);
    const grantScope = (
      scope: GrantHistory["scope"],
      rounds: readonly number[],
      evidence: EvidenceRef[],
    ): GrantFlowScope => ({
      policyId: "vestry-single-round-demo-v1",
      status: scope,
      grantId: w.grantId,
      observedRounds: rounds.map(String),
      historyComplete: true,
      blockingReasons: [],
      causalEvidence: evidence,
      reconciliationDigest: null,
      futureExternalActionsPrevented: false,
    });
    const mapping = (
      state: NativeAccountState,
      anchor: Snapshot["anchor"],
      evidence: EvidenceRef[],
    ) => [
      {
        role: "P" as const,
        account: w.pure!,
        h160: contractAddress(w.pure!),
        branch: "normal_non_EE" as const,
        status: "verified" as const,
        originalAccountEntry: state.mappedTo,
        effectiveReverseAccount: state.mappedTo,
        mappingHoldNative: liabilities(state.holds, evidence)
          .filter((entry) => entry.reason.includes("AddressMapping"))
          .reduce((sum, entry) => sum + BigInt(entry.amountNative), 0n)
          .toString(),
        anchor,
        evidence,
      },
    ];
    const beforeSnapshot = await createSnapshot({
      profile,
      anchor: beforeAnchor,
      pure: w.pure,
      authority: {
        state: "M0Only",
        fullInventoryObserved: true,
        tuples: originalTuples,
        unsupportedTuplesRaw: [],
        evidence: [baseEvidence],
      },
      accounting: beforeAccounting,
      mapping: mapping(baselineAccount, beforeAnchor, [baseEvidence]),
      grantScope: grantScope(beforeScope.scope, beforeScope.rounds, [
        grantEvidence,
      ]),
      sourceEvidence: [baseEvidence, grantEvidence],
      completeness: "complete",
    });
    const afterSnapshot = await createSnapshot({
      profile,
      anchor: afterAnchor,
      pure: w.pure,
      authority: {
        state: "M1Only",
        fullInventoryObserved: true,
        tuples: currentTuples,
        unsupportedTuplesRaw: [],
        evidence: [stateEvidence],
      },
      accounting,
      mapping: mapping(current, afterAnchor, [stateEvidence]),
      grantScope: grantScope(history.scope, history.rounds, [grantEvidence]),
      sourceEvidence: [stateEvidence, grantEvidence],
      completeness: "complete",
    });
    if (
      (await validateRecordSemantics(beforeSnapshot)).length ||
      (await validateRecordSemantics(afterSnapshot)).length
    )
      return null;
    const removals = input.records
      .filter(
        (record): record is ReceiptBundle =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-ROTATION-REMOVE-M0",
      )
      .sort((a, b) =>
        Number(
          BigInt(b.anchor?.blockNumber ?? "0") -
            BigInt(a.anchor?.blockNumber ?? "0"),
        ),
      );
    const continuations = input.records.filter(
      (record): record is ReceiptBundle =>
        record.kind === "ReceiptBundle" &&
        record.operationId === "GRC-GRANT-SUBMIT-M1",
    );
    for (const removal of removals)
      for (const continuation of continuations) {
        if (
          !removal.anchor ||
          !continuation.anchor ||
          BigInt(continuation.anchor.blockNumber) <
            BigInt(removal.anchor.blockNumber) ||
          continuation.causalBusinessContext.grantId !== w.grantId
        )
          continue;
        const removeProof = await proveReceipt(input, removal, baselineAccount),
          continueProof = await proveReceipt(
            input,
            continuation,
            baselineAccount,
          );
        if (!removeProof || !continueProof) continue;
        const originalIdentity = {
          P: w.pure,
          hP: contractAddress(w.pure),
          grantee: w.baseline.grant.grantee,
          reverseMappingAccount: baselineAccount.mappedTo!,
          milestone0Tuple: tuple,
          tupleMultiplicity: String(
            oldSchedules.filter(
              (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
            ).length,
          ),
          creationReceipt: pureCreationEvidence,
          grantId: w.grantId,
          contractAddress: w.contract,
          mappingBranch: "normal_non_EE" as const,
          originalAccountEntry: baselineAccount.mappedTo!,
          mappingEvidence: [baseEvidence],
          grantCreationReceipt: grantEvidence,
        };
        const identity = {
          ...originalIdentity,
          grantee: input.currentGrant.grantee,
          reverseMappingAccount: current.mappedTo,
          originalAccountEntry: current.mappedTo,
          mappingEvidence: [stateEvidence],
          milestone0Tuple: newSchedules.find(
            (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
          )!,
          tupleMultiplicity: String(
            newSchedules.filter(
              (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
            ).length,
          ),
        };
        const certificate = await issueContinuityCertificate({
          before: beforeAnchor,
          after: afterSnapshot,
          identity,
          originalIdentity,
          M0: w.M0,
          M1: w.M1,
          removal,
          continuation,
          removalSigners: [w.participants.A, w.participants.D],
          continuationSigners: [w.participants.A, w.participants.D],
          requiredAD: [w.participants.A, w.participants.D],
          profileId: profile.profileId,
          profileDigest: profile.digest,
          removalEnvelope: removeProof.envelope,
          continuationEnvelope: continueProof.envelope,
          removalAttempt: removeProof.attempt,
          continuationAttempt: continueProof.attempt,
          removalParticipationEvidence: removeProof.participation,
          continuationParticipationEvidence: continueProof.participation,
          evidence: [
            baseEvidence,
            stateEvidence,
            grantEvidence,
            ...removeProof.participation,
            ...continueProof.participation,
          ],
        });
        if (
          certificate.verdict === "verified" ||
          certificate.verdict === "historically_verified_current_drift"
        )
          return { certificate, beforeSnapshot, afterSnapshot };
      }
    return null;
  } catch {
    return null;
  }
}
