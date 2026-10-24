import {
  canonicalJson,
  verifyRecordDigest,
  sealRecord,
  requireRecord,
  validateRecordSemantics,
} from "@account-handoff/contracts";
import type {
  CanonicalRecord,
  ContinuityCertificate,
  EventRecord,
  FrozenEnvelope,
  LayerResult,
  ReceiptBundle,
  SignedAttempt,
  Snapshot,
  PreservedIdentity,
  Controller,
  ReadAnchor,
  EvidenceRef,
} from "@account-handoff/contracts";
import {
  classifyAuthority,
  hasPreservedSchedule,
} from "@account-handoff/domain";

export interface ReceiptAssessment {
  businessEffect: ReceiptBundle["businessEffect"];
  status: ReceiptBundle["status"];
  reasons: string[];
  layers: LayerResult[];
  proposalConsumed: boolean | null;
}

function eventResult(event: EventRecord): LayerResult["result"] {
  const decoded = event.decoded;
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
    return "unavailable";
  const result = decoded.result;
  if (
    result === "success" ||
    result === "Ok" ||
    result === "ok" ||
    result === true
  )
    return "success";
  if (
    result === "failure" ||
    result === "Err" ||
    result === "err" ||
    result === false
  )
    return "failure";
  if (result && typeof result === "object" && !Array.isArray(result)) {
    if (
      "Ok" in result ||
      "ok" in result ||
      result.type === "Ok" ||
      result.isOk === true
    )
      return "success";
    if (
      "Err" in result ||
      "err" in result ||
      result.type === "Err" ||
      result.isErr === true
    )
      return "failure";
  }
  return "unavailable";
}

/** Interprets events already decoded against their execution runtime; never uses wrapper-success as inner success. */
export function classifyNativeOutcome(
  events: readonly EventRecord[],
  path: FrozenEnvelope["signingPath"],
  extrinsicIndex: string,
): ReceiptAssessment {
  const relevant = events.filter(
    (event) => event.extrinsicIndex === extrinsicIndex,
  );
  const reasons: string[] = [];
  const layers: LayerResult[] = [];
  const add = (
    layer: LayerResult["layer"],
    matching: EventRecord[],
    directResult?: LayerResult["result"],
  ): void => {
    const result =
      directResult ??
      (matching.length === 1 ? eventResult(matching[0]!) : "unavailable");
    if (matching.length > 1)
      reasons.push(
        `Multiple ${layer} result events require explicit nested correlation`,
      );
    layers.push({
      layer,
      pathOrdinal: String(layers.length),
      result,
      eventIndices: matching.map((e) => e.nativeEventIndex),
      error: result === "failure" ? `${layer} dispatch failed` : null,
      revertBytes: null,
    });
  };
  const success = relevant.filter(
    (e) => e.pallet === "System" && e.event === "ExtrinsicSuccess",
  );
  const failed = relevant.filter(
    (e) => e.pallet === "System" && e.event === "ExtrinsicFailed",
  );
  add(
    "System",
    [...success, ...failed],
    success.length === 1 && failed.length === 0
      ? "success"
      : failed.length === 1 && success.length === 0
        ? "failure"
        : "unavailable",
  );
  const multisigEvents = relevant.filter(
    (e) => e.pallet === "Multisig" && e.event === "MultisigExecuted",
  );
  const pendingApproval = relevant.some(
    (e) =>
      e.pallet === "Multisig" &&
      ["NewMultisig", "MultisigApproval"].includes(e.event),
  );
  if (path !== "direct") add("Multisig", multisigEvents);
  if (path === "multisig_proxy")
    add(
      "Proxy",
      relevant.filter(
        (e) => e.pallet === "Proxy" && e.event === "ProxyExecuted",
      ),
    );
  const proxyEvent = relevant.find(
    (event) => event.pallet === "Proxy" && event.event === "ProxyExecuted",
  );
  const multisigEvent = multisigEvents[0];
  const systemEvent = success[0] ?? failed[0];
  const invalidOrder =
    (multisigEvent &&
      systemEvent &&
      BigInt(multisigEvent.nativeEventIndex) >=
        BigInt(systemEvent.nativeEventIndex)) ||
    (path === "multisig_proxy" &&
      proxyEvent &&
      multisigEvent &&
      BigInt(proxyEvent.nativeEventIndex) >=
        BigInt(multisigEvent.nativeEventIndex));
  if (invalidOrder)
    return {
      status: "unresolved",
      businessEffect: "unknown",
      reasons: [
        "Nested result events are inconsistent with the expected dispatch order",
      ],
      layers,
      proposalConsumed: null,
    };
  const hasFailure = layers.some((l) => l.result === "failure");
  const unavailable = layers.some((l) => l.result === "unavailable");
  if (pendingApproval && !multisigEvents.length && !hasFailure)
    return {
      status: "finalized_success",
      businessEffect: "not_attempted",
      reasons: ["First approval recorded; inner action has not executed"],
      layers,
      proposalConsumed: false,
    };
  if (hasFailure)
    return {
      status: "finalized_failure",
      businessEffect: "failed",
      reasons: [...reasons, "A required dispatch layer failed"],
      layers,
      proposalConsumed: multisigEvents.length === 1 ? true : null,
    };
  if (unavailable)
    return {
      status: "unresolved",
      businessEffect: "unknown",
      reasons: [...reasons, "Required nested dispatch evidence is unavailable"],
      layers,
      proposalConsumed: multisigEvents.length === 1 ? true : null,
    };
  return {
    status: "finalized_success",
    businessEffect: "historically_verified",
    reasons,
    layers,
    proposalConsumed: path === "direct" ? null : true,
  };
}

export interface VerifyReceiptInput {
  receipt: ReceiptBundle;
  envelope: FrozenEnvelope;
  attempt: SignedAttempt;
  requiredPostconditionIds: readonly string[];
  expectedContractEmitter?: string;
}

export async function verifyReceipt(
  input: VerifyReceiptInput,
): Promise<ReceiptAssessment> {
  const { receipt, envelope, attempt } = input;
  const assessment = classifyNativeOutcome(
    receipt.events,
    envelope.signingPath,
    receipt.extrinsicIndex,
  );
  const reject = (
    reason: string,
    effect: ReceiptBundle["businessEffect"] = "context_mismatch",
  ): void => {
    assessment.reasons.push(reason);
    assessment.status = "unresolved";
    assessment.businessEffect = effect;
  };
  for (const record of [receipt, envelope, attempt])
    if (!(await verifyRecordDigest(record)))
      reject(`Invalid ${record.kind} digest`);
  if (
    receipt.profileDigest !== attempt.profileDigest ||
    receipt.profileDigest !== envelope.intent.profileDigest ||
    receipt.profileId !== envelope.intent.profileId
  )
    reject("Profile identity differs between receipt, attempt and envelope");
  if (
    receipt.intentId !== envelope.intent.intentId ||
    attempt.envelopeDigest !== envelope.digest ||
    receipt.signedAttemptId !== attempt.recordId ||
    receipt.extrinsicHash !== attempt.signedExtrinsicHash
  )
    reject("Receipt does not identify the exact reviewed attempt");
  if (
    !receipt.anchor?.finalized ||
    receipt.anchor.blockHash !== receipt.blockHash
  )
    reject("Receipt does not reference a coherent finalized anchor");
  if (
    receipt.operationId !== envelope.intent.operationId ||
    receipt.signingPath !== envelope.signingPath
  )
    reject("Receipt operation route differs from its envelope");
  const ids = receipt.events.map((event) => event.nativeEventIndex);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => index > 0 && BigInt(id) <= BigInt(ids[index - 1]!))
  )
    reject("Events are duplicated or out of execution order");
  for (const id of input.requiredPostconditionIds) {
    const condition = receipt.postconditions.find((entry) => entry.id === id);
    if (
      !condition ||
      condition.result !== "passed" ||
      condition.anchor?.blockHash !== receipt.blockHash
    )
      reject(
        `Postcondition ${id} is not established at receipt anchor`,
        condition?.result === "failed" ? "configuration_diverged" : "unknown",
      );
  }
  if (input.expectedContractEmitter) {
    const matching = receipt.events.filter(
      (event) =>
        event.contractEmitter === input.expectedContractEmitter &&
        event.extrinsicIndex === receipt.extrinsicIndex,
    );
    if (!matching.length)
      reject("Expected contract emitter is absent", "unknown");
    if (
      receipt.causalBusinessContext.assessment !== "matched" ||
      !receipt.causalBusinessContext.orderedHistoryComplete
    )
      reject(
        "Ordered grant context does not establish the intended action",
        "unknown",
      );
    if (receipt.causalBusinessContext.roundAtIntendedEvent !== "0")
      reject("Grant action occurred outside the supported original round");
  }
  return assessment;
}

export interface ContinuityInput {
  before: ReadAnchor;
  after: Snapshot;
  identity: PreservedIdentity;
  originalIdentity: PreservedIdentity;
  M0: Controller;
  M1: Controller;
  removal: ReceiptBundle;
  continuation: ReceiptBundle;
  removalSigners: readonly string[];
  continuationSigners: readonly string[];
  requiredAD: readonly [string, string];
  profileId: string;
  profileDigest: string;
}

export function assessContinuity(input: ContinuityInput): {
  verdict: ContinuityCertificate["verdict"];
  criteria: ContinuityCertificate["criteria"];
  reasons: string[];
} {
  const reasons: string[] = [];
  const result = (condition: boolean, reason: string): "passed" | "failed" => {
    if (!condition) reasons.push(reason);
    return condition ? "passed" : "failed";
  };
  const {
    identity: current,
    originalIdentity: initial,
    removal,
    continuation,
    after,
  } = input;
  const sameAD = (signers: readonly string[]): boolean =>
    signers.length === 2 &&
    signers[0] === input.requiredAD[0] &&
    signers[1] === input.requiredAD[1];
  const sameProfile =
    [removal, continuation].every(
      (r) =>
        r.profileId === input.profileId &&
        r.profileDigest === input.profileDigest,
    ) && after.profileDigest === input.profileDigest;
  const criteria: ContinuityCertificate["criteria"] = {
    pureIdentity: result(
      current.P === initial.P && after.pure === initial.P,
      "Beneficiary identity changed",
    ),
    h160Identity: result(
      current.hP === initial.hP,
      "Application identity changed",
    ),
    reverseMapping: result(
      current.reverseMappingAccount === initial.P &&
        current.mappingBranch === "normal_non_EE",
      "Persisted reverse mapping is not established",
    ),
    grantBeneficiary: result(
      current.grantee === initial.grantee &&
        current.grantId === initial.grantId &&
        current.contractAddress === initial.contractAddress &&
        canonicalJson(current.grantCreationReceipt) ===
          canonicalJson(initial.grantCreationReceipt),
      "Grant binding changed",
    ),
    activeVestingTuple: result(
      canonicalJson(current.milestone0Tuple) ===
        canonicalJson(initial.milestone0Tuple) &&
        current.tupleMultiplicity === initial.tupleMultiplicity &&
        hasPreservedSchedule(
          [initial.milestone0Tuple],
          [current.milestone0Tuple],
        ),
      "Original vesting provenance or multiplicity changed",
    ),
    backing: result(
      after.accounting?.status === "reconciled" &&
        after.accounting.unexplainedReservedDeltaNative === "0",
      "Backing is unreconciled",
    ),
    exactNewAuthority: result(
      classifyAuthority(
        after.authority.tuples,
        input.M0.account,
        input.M1.account,
      ) === "M1Only" && after.authority.fullInventoryObserved,
      "New controller is not the only observed authority",
    ),
    attributedMilestone1Submission: result(
      continuation.operationId === "GRC-GRANT-SUBMIT-M1" &&
        continuation.businessEffect === "historically_verified" &&
        continuation.causalBusinessContext.assessment === "matched" &&
        continuation.causalBusinessContext.milestoneIndex === "1" &&
        sameProfile &&
        continuation.anchor !== null &&
        removal.anchor !== null &&
        (BigInt(continuation.anchor.blockNumber) >
          BigInt(removal.anchor.blockNumber) ||
          (continuation.anchor.blockHash === removal.anchor.blockHash &&
            BigInt(continuation.extrinsicIndex) >
              BigInt(removal.extrinsicIndex))),
      "Separate attributed next submission is missing",
    ),
    removalQuorumAD: result(
      removal.operationId === "GRC-ROTATION-REMOVE-M0" &&
        removal.businessEffect === "historically_verified" &&
        sameAD(input.removalSigners),
      "Removal did not establish A-first/D-final execution",
    ),
    continuationQuorumAD: result(
      sameAD(input.continuationSigners),
      "Continuation did not establish A-first/D-final execution",
    ),
    singleRoundBusinessContext: result(
      continuation.causalBusinessContext.roundAtIntendedEvent === "0" &&
        continuation.causalBusinessContext.orderedHistoryComplete,
      "Single-round business context is not established",
    ),
  };
  if (reasons.length) return { verdict: "incomplete", criteria, reasons };
  return {
    verdict:
      after.grantScope.status === "EligibleSingleRound" &&
      !continuation.currentStateDrift
        ? "verified"
        : "historically_verified_current_drift",
    criteria,
    reasons,
  };
}

export function recordReferences(record: CanonicalRecord): string[] {
  switch (record.kind) {
    case "ReceiptBundle":
      return [record.signedAttemptId];
    case "ContinuityCertificate":
      return [
        record.removalReceiptId,
        record.milestone1SubmissionReceiptId,
      ].filter((x): x is string => x !== null);
    default:
      return [];
  }
}

export interface CertificateInput extends ContinuityInput {
  removalEnvelope: FrozenEnvelope;
  continuationEnvelope: FrozenEnvelope;
  removalAttempt: SignedAttempt;
  continuationAttempt: SignedAttempt;
  removalParticipationEvidence: EvidenceRef[];
  continuationParticipationEvidence: EvidenceRef[];
  evidence: EvidenceRef[];
  recordId?: string;
}

/** Issues an anchor-specific result from locally reconstructed native evidence, never imported success labels. */
export async function issueContinuityCertificate(
  input: CertificateInput,
): Promise<ContinuityCertificate> {
  const result = assessContinuity(input);
  if ((await validateRecordSemantics(input.after)).length > 0) {
    result.criteria.backing = "unknown";
    result.criteria.exactNewAuthority = "unknown";
    result.verdict = "incomplete";
  }
  const [removal, continuation] = await Promise.all([
    verifyReceipt({
      receipt: input.removal,
      envelope: input.removalEnvelope,
      attempt: input.removalAttempt,
      requiredPostconditionIds: [],
    }),
    verifyReceipt({
      receipt: input.continuation,
      envelope: input.continuationEnvelope,
      attempt: input.continuationAttempt,
      requiredPostconditionIds: [],
      expectedContractEmitter: input.identity.contractAddress,
    }),
  ]);
  if (removal.businessEffect !== "historically_verified") {
    result.criteria.exactNewAuthority = "unknown";
    result.criteria.removalQuorumAD = "unknown";
    result.verdict = "incomplete";
  }
  if (continuation.businessEffect !== "historically_verified") {
    result.criteria.attributedMilestone1Submission = "unknown";
    result.criteria.singleRoundBusinessContext = "unknown";
    result.verdict = "incomplete";
  }
  if (
    !input.removalParticipationEvidence.length ||
    !input.continuationParticipationEvidence.length ||
    !input.evidence.length
  ) {
    result.verdict = "incomplete";
    if (!input.removalParticipationEvidence.length)
      result.criteria.removalQuorumAD = "unknown";
    if (!input.continuationParticipationEvidence.length)
      result.criteria.continuationQuorumAD = "unknown";
  }
  const certificate: ContinuityCertificate = {
    schemaVersion: "2",
    kind: "ContinuityCertificate",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? `continuity-${globalThis.crypto.randomUUID()}`,
    digest: "",
    profileId: input.profileId,
    profileDigest: input.profileDigest,
    verdict: result.verdict,
    before: input.before,
    after: input.after.anchor,
    identity: input.identity,
    M0: input.M0,
    M1: input.M1,
    removalReceiptId: input.removal.recordId,
    milestone1SubmissionReceiptId: input.continuation.recordId,
    criteria: result.criteria,
    independentCustodyProven: false,
    BReadinessStatus: "unknown",
    legalOrFunderConsentInferred: false,
    evidence: input.evidence,
    derivedFromRecordDigest: null,
    grantScopeAtSubmission:
      continuation.businessEffect === "historically_verified"
        ? "EligibleSingleRound"
        : "Unverified",
    currentGrantScope: input.after.grantScope,
    removalParticipationEvidence: input.removalParticipationEvidence,
    continuationParticipationEvidence: input.continuationParticipationEvidence,
    scopeOfProof:
      "anchor_specific_native_authority_and_attributed_next_submission_not_reviewer_payment_or_legal_consent",
  };
  const sealed = await sealRecord(certificate);
  requireRecord(sealed);
  return sealed;
}
