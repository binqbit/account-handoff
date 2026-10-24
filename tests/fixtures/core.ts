import {
  canonicalJson,
  sealRecord,
  semanticIntentDigest,
  sha256,
} from "@account-handoff/contracts";
import type {
  ChainProfile,
  Controller,
  EvidenceRef,
  FrozenEnvelope,
  LocalOperationProgress,
  ParticipantBindings,
  ReadAnchor,
  ReviewedSigningContext,
  SignedAttempt,
  Snapshot,
} from "@account-handoff/contracts";

export const HASH = `0x${"12".repeat(32)}`;
export const DIGEST = "34".repeat(32);
export const account = (byte: number): string =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
export const participants: ParticipantBindings = {
  A: account(1),
  B: account(2),
  C: account(3),
  D: account(4),
  F: account(5),
  R1: account(6),
  R2: account(7),
  S: account(8),
};
export const M0: Controller = {
  account: account(9),
  members: [participants.A, participants.B, participants.C],
  threshold: "2",
  role: "M0",
};
export const M1: Controller = {
  account: account(10),
  members: [participants.A, participants.B, participants.D],
  threshold: "2",
  role: "M1",
};
export const evidence: EvidenceRef = {
  kind: "local_artifact",
  locator: "synthetic:unit-fixture",
  sourceId: "test",
  contentSha256: DIGEST,
};
export function anchor(): ReadAnchor {
  const context = {
    contextId: "synthetic-runtime",
    genesis: HASH,
    runtimeCodeHash: HASH,
    metadataSha256: DIGEST,
    specVersion: "1",
    transactionVersion: "1",
    metadataVersion: "14",
    apiCodecArtifactSha256: null,
    rawEvidence: [evidence],
  };
  return {
    blockHash: HASH,
    blockNumber: "10",
    finalized: true,
    executionRuntimeId: context.contextId,
    postStateRuntimeId: context.contextId,
    apiRuntimeId: context.contextId,
    providerId: "synthetic",
    contextBindings: {
      execution: context,
      postState: context,
      runtimeApi: context,
    },
  };
}
export async function profile(): Promise<ChainProfile> {
  return sealRecord<ChainProfile>({
    schemaVersion: "2",
    kind: "ChainProfile",
    recordId: "profile-fixture",
    digest: DIGEST,
    profileId: "synthetic-profile",
    revision: "1",
    status: "candidate",
    genesis: null,
    specName: null,
    specVersion: null,
    transactionVersion: null,
    runtimeCodeHash: null,
    metadataSha256: null,
    metadataVersion: null,
    transport: "dedot_explicit_legacy",
    accountClass: "normal_non_EE_suffixed_AccountId32",
    apiBindings: [],
    signedExtensions: [],
    gateRecords: [],
    sourceEvidence: [evidence],
    derivedFromRecordDigest: null,
    firstBuildMode: "CONTROLLED_SINGLE_ROUND_DEMONSTRATOR",
    grantPolicyId: "vestry-single-round-demo-v1",
    mappingPolicy: {
      supportedBranch: "normal_non_EE_suffixed_AccountId32",
      autoMap: false,
      explicitMappingRequired: true,
      statelessEEBranchSupported: false,
      reviveOriginRoles: ["P", "F", "R1", "R2"],
      controllerOrMemberMappingRequiredForNativeWrapper: false,
      unmappingEnabled: false,
      qualifiedConfigurationEvidence: [],
    },
    bindingEvidence: {
      metadataHashConvention:
        "SHA256_of_exact_SCALE_metadata_bytes_without_RPC_hex_text",
      runtimeCodeHashConvention:
        "BLAKE2_256_of_exact_runtime_code_storage_bytes",
      rawMetadataEvidence: null,
      rawRuntimeCodeEvidence: null,
      runtimeSourceBuildRelationship: null,
      generatedNativeTypesSha256: null,
      abiSha256: null,
      contractAddress: null,
      contractRuntimeCodeHash: null,
      contractCodeHashConvention:
        "must_be_declared_and_qualified_in_contract_artifact_evidence",
      contractSourceBuildRelationship: null,
      packageLockSha256: null,
      packageArtifactEvidence: [],
      installedWalletEvidence: [],
    },
    localContractRevision: "grc-v2-local-1",
  });
}
export async function snapshot(p: ChainProfile): Promise<Snapshot> {
  return sealRecord<Snapshot>({
    schemaVersion: "2",
    kind: "Snapshot",
    recordId: "snapshot-fixture",
    digest: DIGEST,
    profileId: p.profileId,
    profileDigest: p.digest,
    anchor: anchor(),
    completeness: "complete",
    pure: null,
    observations: {},
    sourceEvidence: [evidence],
    derivedFromRecordDigest: null,
    grantScope: {
      policyId: "vestry-single-round-demo-v1",
      status: "Unverified",
      grantId: null,
      observedRounds: [],
      historyComplete: false,
      blockingReasons: [],
      causalEvidence: [],
      reconciliationDigest: null,
      futureExternalActionsPrevented: false,
    },
    mapping: [],
    accounting: null,
    authority: {
      state: "NotCreated",
      fullInventoryObserved: true,
      tuples: [],
      unsupportedTuplesRaw: [],
      evidence: [evidence],
    },
    gateAssessments: [],
    localContractRevision: "grc-v2-local-1",
  });
}
export async function envelope(
  p: ChainProfile,
  s: Snapshot,
): Promise<FrozenEnvelope> {
  const value: FrozenEnvelope = {
    schemaVersion: "2",
    kind: "FrozenEnvelope",
    recordId: "envelope-fixture",
    digest: DIGEST,
    status: "frozen",
    intent: {
      intentId: "intent-fixture",
      intentRevision: "1",
      operationId: "GRC-SETUP-FUND-M0",
      profileId: p.profileId,
      profileDigest: p.digest,
      authorActor: participants.S,
      parameters: { recipient: M0.account, valueNative: "10" },
      expectedState: {
        snapshotDigest: s.digest,
        authority: "NotApplicable",
        grantContext: null,
        localReviewExpiresAtUnixSeconds: "1000",
        localExpiryRevokesNativeProposal: false,
      },
      supersedesIntentId: null,
    },
    anchor: s.anchor,
    signingPath: "direct",
    controller: null,
    requiredSigners: [participants.S],
    callTree: {
      kind: "native_call",
      palletOrContract: "Balances",
      method: "transfer_keep_alive",
      parameters: { dest: M0.account, valueNative: "10" },
      children: [],
      sourceEvidence: [evidence],
    },
    innerRuntimeCallBytes: "0x0100",
    innerRuntimeCallHash: null,
    resources: {
      valueNative: "10",
      reviveWeight: null,
      storageDepositLimitNative: null,
      multisigInnerMaxWeight: null,
      outerFeeEstimateNative: "1",
      outerFeeLocalBudgetNative: "2",
      feeBudgetIsChainEnforcedCap: false,
      estimationEvidence: [evidence],
    },
    summaryText: "Synthetic fixture funding",
    requiredGateIds: ["Q-RUNTIME"],
    evidence: [evidence],
    derivedFromRecordDigest: null,
    participants,
    localContractRevision: "grc-v2-local-1",
    semanticIntentDigest: null,
  };
  value.semanticIntentDigest = await semanticIntentDigest(value);
  return sealRecord(value);
}
export async function signingContext(
  e: FrozenEnvelope,
): Promise<ReviewedSigningContext> {
  const payload = canonicalJson({
    address: participants.S,
    method: "0x0100",
    nonce: "0x00",
    version: 4,
    blockHash: HASH,
    blockNumber: "0xa",
    era: "0x00",
    genesisHash: HASH,
    specVersion: "0x1",
    transactionVersion: "0x1",
    tip: "0x0",
    signedExtensions: [],
    withSignedTransaction: false,
  });
  return {
    requestId: "request-fixture",
    walletBuildId: "synthetic-wallet",
    signer: participants.S,
    genesis: HASH,
    specVersion: "1",
    transactionVersion: "1",
    runtimeCodeHash: HASH,
    metadataSha256: DIGEST,
    signedExtensions: [],
    nonce: "0",
    era: "0x00",
    mortalityBlockHash: HASH,
    outerCallBytes: "0x0100",
    outerCallHash: HASH,
    extrinsicVersion: "4",
    encodedExtraPayloadBytes: "0x00",
    tipNative: "0",
    feeAssetId: null,
    metadataHashExtensionValue: null,
    originalSignPayloadJcsUtf8: payload,
    additionalSignedPayloadBytes: "0x",
    signPayloadSha256: await sha256(payload),
    additionalSignedContextSha256: await sha256(new Uint8Array()),
    withSignedTransactionRequested: false,
    walletReturnedSignedTransactionAccepted: false,
    operationPhase: "direct",
    nativeProposalDigest: null,
  };
}
export async function progress(
  e: FrozenEnvelope,
): Promise<LocalOperationProgress> {
  const context = await signingContext(e);
  return {
    journalVersion: "1",
    kind: "LocalOperationProgress",
    journalId: "progress-fixture",
    intentId: e.intent.intentId,
    envelopeDigest: e.digest,
    requestId: context.requestId,
    phase: "WalletRequested",
    profileId: e.intent.profileId,
    profileDigest: e.intent.profileDigest,
    outerCallSha256: await sha256(new Uint8Array([1, 0])),
    requestedSigner: participants.S,
    reviewedRequestDigest: context.signPayloadSha256,
    requestedAtUnixSeconds: "100",
    acceptedSignedAttemptId: null,
    observations: [],
    portable: false,
    localContractRevision: "grc-v2-local-1",
    reviewedSigningContext: context,
  };
}
export async function signedAttempt(e: FrozenEnvelope): Promise<SignedAttempt> {
  const context = await signingContext(e);
  return sealRecord<SignedAttempt>({
    schemaVersion: "2",
    kind: "SignedAttempt",
    recordId: "attempt-fixture",
    digest: DIGEST,
    intentId: e.intent.intentId,
    envelopeDigest: e.digest,
    profileId: e.intent.profileId,
    profileDigest: e.intent.profileDigest,
    signer: participants.S,
    nonce: "0",
    era: "0x00",
    signedExtrinsicHash: HASH,
    signedExtrinsicBytes: "0x0400",
    bytesOmissionReason: null,
    reviewedSigningContext: context,
    signingContextSha256: await sha256(canonicalJson(context)),
    status: "signed",
    observations: [],
    derivedFromRecordDigest: null,
    recordScope: "local_journal",
    localContractRevision: "grc-v2-local-1",
  });
}
