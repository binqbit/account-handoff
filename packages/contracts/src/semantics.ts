import {
  canonicalJson,
  semanticIntentDigest,
  sha256,
  verifyRecordDigest,
} from "./canonical.js";
import { parseBoundedJson } from "./bounded-parser.js";
import type {
  CanonicalRecord,
  FrozenEnvelope,
  LocalOperationProgress,
  ReadAnchor,
} from "./records.js";

export interface SemanticIssue {
  code: string;
  message: string;
  guardId: string;
}
const normalAccount = (account: string): boolean =>
  /^0x[0-9a-f]{64}$/.test(account) && !account.endsWith("ee".repeat(12));

export function anchorIssues(anchor: ReadAnchor): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  for (const [name, id, context] of [
    ["execution", anchor.executionRuntimeId, anchor.contextBindings.execution],
    ["postState", anchor.postStateRuntimeId, anchor.contextBindings.postState],
    ["runtimeApi", anchor.apiRuntimeId, anchor.contextBindings.runtimeApi],
  ] as const) {
    if (id !== context.contextId)
      issues.push({
        code: "RuntimeContextMismatch",
        message: `${name} context does not match its anchor ID`,
        guardId: "SG-04",
      });
  }
  const contexts = Object.values(anchor.contextBindings);
  if (new Set(contexts.map((context) => context.genesis)).size !== 1)
    issues.push({
      code: "GenesisMismatch",
      message: "Anchor runtime contexts belong to different chains",
      guardId: "SG-04",
    });
  return issues;
}

/** Cross-field consistency only. Successful checks do not make an imported record authoritative. */
export async function validateRecordSemantics(
  record: CanonicalRecord,
): Promise<SemanticIssue[]> {
  const issues: SemanticIssue[] = [];
  const add = (code: string, message: string, guardId: string): void => {
    issues.push({ code, message, guardId });
  };
  if (!(await verifyRecordDigest(record)))
    add(
      "RecordDigestMismatch",
      "Record content differs from its digest",
      "SG-02",
    );
  if ("anchor" in record && record.anchor)
    issues.push(...anchorIssues(record.anchor));
  if (record.kind === "ChainProfile") {
    for (const binding of record.apiBindings)
      if (
        binding.status === "qualified" &&
        (binding.boundRuntimeCodeHash !== record.runtimeCodeHash ||
          binding.boundMetadataSha256 !== record.metadataSha256)
      )
        add(
          "ApiBindingMismatch",
          "Qualified API does not match this runtime/metadata",
          "SG-05",
        );
    if (
      record.mappingPolicy.autoMap === record.mappingPolicy.explicitMappingRequired
    )
      add(
        "UnsupportedMappingPolicy",
        "Mapping policy must select exactly one automatic or explicit mapping branch",
        "SG-08",
      );
  }
  if (record.kind === "Snapshot") {
    for (const [name, observation] of Object.entries(record.observations))
      if (
        observation.anchor !== null &&
        observation.anchor.blockHash !== record.anchor.blockHash
      )
        add(
          "MixedAnchor",
          `Observation ${name} was read from another block`,
          "SG-06",
        );
    for (const mapping of record.mapping) {
      if (!normalAccount(mapping.account))
        add(
          "UnsupportedMappingBranch",
          "Origin uses unsupported EE-suffix account class",
          "SG-08",
        );
      if (
        mapping.status === "verified" &&
        (mapping.effectiveReverseAccount !== mapping.account ||
          mapping.originalAccountEntry !== mapping.account ||
          mapping.anchor.blockHash !== record.anchor.blockHash)
      )
        add(
          "MappingMismatch",
          "Verified mapping lacks coherent persisted reverse identity",
          "SG-08",
        );
    }
    if (record.accounting?.status === "reconciled") {
      const ledger = record.accounting;
      const obligations =
        [...ledger.pureReasonHolds, ...ledger.pureNamedReserves].reduce(
          (sum, item) => sum + BigInt(item.amountNative),
          0n,
        ) +
        BigInt(ledger.pureOtherTracedReservedLiabilitiesNative) +
        BigInt(ledger.pureProxyIncrementNative);
      if (
        BigInt(ledger.pureReservedNative) !== obligations ||
        BigInt(ledger.pureBackedLiabilitiesNative) !== obligations ||
        ledger.unexplainedReservedDeltaNative !== "0"
      )
        add(
          "AccountingMismatch",
          "Reserved balance and disjoint liabilities do not reconcile",
          "SG-10",
        );
      if (
        ledger.creatorCurrentAggregateReservedNative === null ||
        BigInt(ledger.creatorCurrentAggregateReservedNative) <
          BigInt(ledger.creatorHistoricalDepositNative)
      )
        add(
          "CreatorReserveMissing",
          "Historical creator deposit is not backed",
          "SG-11",
        );
    }
  }
  if (record.kind === "FrozenEnvelope") {
    if (
      record.status !== "draft" &&
      record.semanticIntentDigest !== (await semanticIntentDigest(record))
    )
      add(
        "SemanticDigestMismatch",
        "Envelope semantic projection changed",
        "SG-29",
      );
    const participants = [
      record.participants.A,
      record.participants.B,
      record.participants.C,
      ...(record.participants.D ? [record.participants.D] : []),
    ];
    if (new Set(participants).size !== participants.length)
      add(
        "DuplicateParticipant",
        "Assigned signer roles must have distinct canonical identities",
        "SG-07",
      );
    const newQuorum = [
      "GRC-ROTATION-REMOVE-M0",
      "GRC-GRANT-SUBMIT-M1",
    ].includes(record.intent.operationId);
    const oldQuorum = [
      "GRC-SETUP-CREATE-PURE",
      "GRC-SETUP-MAP-P",
      "GRC-ROTATION-ADD-M1",
      "GRC-GRANT-SUBMIT-M0",
    ].includes(record.intent.operationId);
    const expected = newQuorum
      ? [record.participants.A, record.participants.D]
      : [record.participants.A, record.participants.B];
    if (
      (newQuorum || oldQuorum) &&
      canonicalJson(record.requiredSigners) !== canonicalJson(expected)
    )
      add(
        "SignerSequenceMismatch",
        "Required signers differ from the selected demonstration sequence",
        "SG-07",
      );
    if (
      record.innerRuntimeCallBytes &&
      (record.innerRuntimeCallBytes.length - 2) / 2 > 131072
    )
      add("CallTooLarge", "RuntimeCall exceeds the decoded byte cap", "SG-01");
    const evidence = record.intent.parameters.evidence;
    if (
      typeof evidence === "string" &&
      new TextEncoder().encode(evidence).length > 1024
    )
      add(
        "EvidenceTooLarge",
        "Milestone evidence exceeds UTF-8 byte limit",
        "SG-01",
      );
  }
  if (record.kind === "SignedAttempt") {
    const context = record.reviewedSigningContext;
    if (
      context.signer !== record.signer ||
      context.nonce !== record.nonce ||
      context.era !== record.era
    )
      add(
        "SigningContextMismatch",
        "Signed attempt differs from reviewed signer/nonce/era",
        "SG-18",
      );
    try {
      const wallet = parseBoundedJson(context.originalSignPayloadJcsUtf8, {
        maxBytes: 262144,
      });
      if (
        canonicalJson(wallet) !== context.originalSignPayloadJcsUtf8 ||
        (await sha256(context.originalSignPayloadJcsUtf8)) !==
          context.signPayloadSha256
      )
        add(
          "WalletPayloadMismatch",
          "Original wallet request does not match its canonical digest",
          "SG-30",
        );
      if (
        (await sha256(canonicalJson(context))) !== record.signingContextSha256
      )
        add(
          "SigningContextHashMismatch",
          "Signing context digest differs",
          "SG-18",
        );
    } catch {
      add(
        "MalformedWalletPayload",
        "Original wallet request cannot be parsed safely",
        "SG-30",
      );
    }
  }
  if (record.kind === "ReceiptBundle") {
    const indices = record.events.map((event) =>
      BigInt(event.nativeEventIndex),
    );
    if (
      indices.some((value, index) => index > 0 && value <= indices[index - 1]!)
    )
      add(
        "EventOrderMismatch",
        "Receipt events are not uniquely ordered",
        "SG-22",
      );
    if (
      record.events.some(
        (event) => event.extrinsicIndex !== record.extrinsicIndex,
      )
    )
      add(
        "ExtrinsicMismatch",
        "Receipt contains another extrinsic’s events",
        "SG-22",
      );
    if (
      record.status === "finalized_success" &&
      record.businessEffect === "historically_verified" &&
      record.layers.some(
        (layer) => layer.result === "failure" || layer.result === "unavailable",
      )
    )
      add(
        "FalseCompletion",
        "Business success contradicts a required execution layer",
        "SG-22",
      );
  }
  return issues;
}

export function semanticConflict(
  envelopes: readonly FrozenEnvelope[],
): boolean {
  const seen = new Map<string, string>();
  for (const envelope of envelopes) {
    if (!envelope.semanticIntentDigest) continue;
    const key = `${envelope.intent.intentId}:${envelope.intent.intentRevision}`;
    const prior = seen.get(key);
    if (prior && prior !== envelope.semanticIntentDigest) return true;
    seen.set(key, envelope.semanticIntentDigest);
  }
  return false;
}

export function isUnresolvedProgress(
  progress: LocalOperationProgress,
): boolean {
  return ["WalletRequested", "WalletOutcomeUnknown"].includes(progress.phase);
}
