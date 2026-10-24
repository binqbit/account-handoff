import {
  sealRecord,
  semanticIntentDigest,
  sha256,
  canonicalJson,
} from "./canonical.js";
import { requireRecord, validateLocalProgress } from "./validation.js";
import { ContractError } from "./errors.js";
import type {
  ApiBinding,
  AuthorityObservation,
  BindingEvidence,
  ChainProfile,
  EvidenceRef,
  FrozenEnvelope,
  GateRecord,
  GrantFlowScope,
  Intent,
  LocalOperationProgress,
  MappingObservation,
  Observation,
  ParticipantBindings,
  ReadAnchor,
  ReceiptBundle,
  ResourceBounds,
  RuntimeContext,
  SignedAttempt,
  Snapshot,
  AccountingLedger,
  Controller,
  CallTree,
  ReviewedSigningContext,
} from "./records.js";

export const newRecordId = (kind: string): string =>
  `${kind}-${globalThis.crypto.randomUUID()}`;
export function hexBytes(hex: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(hex))
    throw new ContractError(
      "InvalidHex",
      "Expected lower-case hexadecimal bytes",
    );
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}

export interface FingerprintInput {
  genesis: string;
  specName: string;
  specVersion: string;
  transactionVersion: string;
  metadataVersion: string;
  metadataSha256: string;
  runtimeCodeHash: string;
  signedExtensions: string[];
}

export async function createChainProfile(input: {
  profileId: string;
  fingerprint: FingerprintInput;
  sourceEvidence: EvidenceRef[];
  recordId?: string;
  status?: ChainProfile["status"];
  gateRecords?: GateRecord[];
  apiBindings?: ApiBinding[];
  bindingEvidence?: Partial<BindingEvidence>;
  mappingConfigurationEvidence?: EvidenceRef[];
}): Promise<ChainProfile> {
  const f = input.fingerprint;
  const profile: ChainProfile = {
    schemaVersion: "2",
    kind: "ChainProfile",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? newRecordId("profile"),
    digest: "",
    profileId: input.profileId,
    revision: "1",
    status: input.status ?? "candidate",
    genesis: f.genesis,
    specName: f.specName,
    specVersion: f.specVersion,
    transactionVersion: f.transactionVersion,
    runtimeCodeHash: f.runtimeCodeHash,
    metadataSha256: f.metadataSha256,
    metadataVersion: f.metadataVersion,
    transport: "dedot_explicit_legacy",
    accountClass: "normal_non_EE_suffixed_AccountId32",
    apiBindings: input.apiBindings ?? [],
    signedExtensions: f.signedExtensions,
    gateRecords: input.gateRecords ?? [],
    sourceEvidence: input.sourceEvidence,
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
      qualifiedConfigurationEvidence: input.mappingConfigurationEvidence ?? [],
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
      ...input.bindingEvidence,
    },
  };
  const sealed = await sealRecord(profile);
  requireRecord(sealed);
  return sealed;
}

export function createReadAnchor(input: {
  blockHash: string;
  blockNumber: string;
  providerId: string;
  context: RuntimeContext;
  postStateContext?: RuntimeContext;
  apiContext?: RuntimeContext;
}): ReadAnchor {
  const postState = input.postStateContext ?? input.context;
  const runtimeApi = input.apiContext ?? postState;
  return {
    blockHash: input.blockHash,
    blockNumber: input.blockNumber,
    finalized: true,
    providerId: input.providerId,
    executionRuntimeId: input.context.contextId,
    postStateRuntimeId: postState.contextId,
    apiRuntimeId: runtimeApi.contextId,
    contextBindings: { execution: input.context, postState, runtimeApi },
  };
}

export function unverifiedGrantScope(): GrantFlowScope {
  return {
    policyId: "vestry-single-round-demo-v1",
    status: "Unverified",
    grantId: null,
    observedRounds: [],
    historyComplete: false,
    blockingReasons: ["Grant history has not been qualified"],
    causalEvidence: [],
    reconciliationDigest: null,
    futureExternalActionsPrevented: false,
  };
}

export async function createSnapshot(input: {
  profile: ChainProfile;
  anchor: ReadAnchor;
  pure?: string | null;
  authority?: AuthorityObservation;
  mapping?: MappingObservation[];
  accounting?: AccountingLedger | null;
  grantScope?: GrantFlowScope;
  observations?: Record<string, Observation>;
  gateAssessments?: GateRecord[];
  sourceEvidence?: EvidenceRef[];
  completeness?: Snapshot["completeness"];
  recordId?: string;
}): Promise<Snapshot> {
  const record: Snapshot = {
    schemaVersion: "2",
    kind: "Snapshot",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? newRecordId("snapshot"),
    digest: "",
    profileId: input.profile.profileId,
    profileDigest: input.profile.digest,
    anchor: input.anchor,
    completeness: input.completeness ?? "incomplete",
    pure: input.pure ?? null,
    authority: input.authority ?? {
      state: "Unknown",
      fullInventoryObserved: false,
      tuples: [],
      unsupportedTuplesRaw: [],
      evidence: [],
    },
    mapping: input.mapping ?? [],
    accounting: input.accounting ?? null,
    grantScope: input.grantScope ?? unverifiedGrantScope(),
    observations: input.observations ?? {},
    gateAssessments: input.gateAssessments ?? [],
    sourceEvidence: input.sourceEvidence ?? [],
    derivedFromRecordDigest: null,
  };
  const sealed = await sealRecord(record);
  requireRecord(sealed);
  return sealed;
}

export async function createFrozenEnvelope(input: {
  intent: Intent;
  anchor: ReadAnchor;
  plan: {
    callTree: CallTree;
    signingPath: FrozenEnvelope["signingPath"];
    controller: Controller | null;
    requiredSigners: string[];
  };
  innerRuntimeCallBytes: string;
  innerRuntimeCallHash: string | null;
  resources: ResourceBounds;
  summaryText: string;
  requiredGateIds: FrozenEnvelope["requiredGateIds"];
  participants: ParticipantBindings;
  evidence: EvidenceRef[];
  recordId?: string;
}): Promise<FrozenEnvelope> {
  const envelope: FrozenEnvelope = {
    schemaVersion: "2",
    kind: "FrozenEnvelope",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? newRecordId("envelope"),
    digest: "",
    intent: input.intent,
    anchor: input.anchor,
    status: "frozen",
    ...input.plan,
    innerRuntimeCallBytes: input.innerRuntimeCallBytes,
    innerRuntimeCallHash: input.innerRuntimeCallHash,
    resources: input.resources,
    summaryText: input.summaryText,
    requiredGateIds: input.requiredGateIds,
    participants: input.participants,
    evidence: input.evidence,
    derivedFromRecordDigest: null,
    semanticIntentDigest: null,
  };
  envelope.semanticIntentDigest = await semanticIntentDigest(envelope);
  const sealed = await sealRecord(envelope);
  requireRecord(sealed);
  return sealed;
}

export async function createLocalProgress(input: {
  envelope: FrozenEnvelope;
  context: ReviewedSigningContext;
  phase?: LocalOperationProgress["phase"];
  atUnixSeconds: string;
  acceptedSignedAttemptId?: string | null;
  recordId?: string;
}): Promise<LocalOperationProgress> {
  const context = input.context;
  const progress: LocalOperationProgress = {
    journalVersion: "1",
    kind: "LocalOperationProgress",
    localContractRevision: "grc-v2-local-1",
    portable: false,
    journalId: input.recordId ?? newRecordId("progress"),
    intentId: input.envelope.intent.intentId,
    envelopeDigest: input.envelope.digest,
    requestId: context.requestId,
    phase: input.phase ?? "WalletRequested",
    profileId: input.envelope.intent.profileId,
    profileDigest: input.envelope.intent.profileDigest,
    outerCallSha256: await sha256(hexBytes(context.outerCallBytes)),
    requestedSigner: context.signer,
    reviewedRequestDigest: context.signPayloadSha256,
    requestedAtUnixSeconds: input.atUnixSeconds,
    acceptedSignedAttemptId: input.acceptedSignedAttemptId ?? null,
    observations: [],
    reviewedSigningContext: context,
  };
  const checked = validateLocalProgress(progress);
  if (!checked.ok)
    throw new ContractError(
      "InvalidProgress",
      "Progress construction failed validation",
      checked.errors,
    );
  return progress;
}

export async function createSignedAttempt(input: {
  envelope: FrozenEnvelope;
  context: ReviewedSigningContext;
  bytes: string;
  hash: string;
  status?: SignedAttempt["status"];
  recordId?: string;
}): Promise<SignedAttempt> {
  const record: SignedAttempt = {
    schemaVersion: "2",
    kind: "SignedAttempt",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? newRecordId("attempt"),
    digest: "",
    intentId: input.envelope.intent.intentId,
    envelopeDigest: input.envelope.digest,
    profileId: input.envelope.intent.profileId,
    profileDigest: input.envelope.intent.profileDigest,
    signer: input.context.signer,
    nonce: input.context.nonce,
    era: input.context.era,
    signedExtrinsicHash: input.hash,
    signedExtrinsicBytes: input.bytes,
    bytesOmissionReason: null,
    reviewedSigningContext: input.context,
    signingContextSha256: await sha256(canonicalJson(input.context)),
    status: input.status ?? "signed",
    observations: [],
    derivedFromRecordDigest: null,
    recordScope: "local_journal",
  };
  const sealed = await sealRecord(record);
  requireRecord(sealed);
  return sealed;
}

export async function createReceiptBundle(input: {
  envelope: FrozenEnvelope;
  attempt: SignedAttempt;
  anchor: ReadAnchor;
  extrinsicIndex: string;
  layers: ReceiptBundle["layers"];
  events: ReceiptBundle["events"];
  postconditions: ReceiptBundle["postconditions"];
  status?: ReceiptBundle["status"];
  businessEffect?: ReceiptBundle["businessEffect"];
  operationPhase: ReceiptBundle["operationPhase"];
  causalBusinessContext: ReceiptBundle["causalBusinessContext"];
  proposalAfter?: ReceiptBundle["proposalAfter"];
  targetProposalAfter?: ReceiptBundle["targetProposalAfter"];
  evidence: EvidenceRef[];
  currentStateDrift?: boolean;
  recordId?: string;
}): Promise<ReceiptBundle> {
  const record: ReceiptBundle = {
    schemaVersion: "2",
    kind: "ReceiptBundle",
    localContractRevision: "grc-v2-local-1",
    recordId: input.recordId ?? newRecordId("receipt"),
    digest: "",
    intentId: input.envelope.intent.intentId,
    profileId: input.envelope.intent.profileId,
    profileDigest: input.envelope.intent.profileDigest,
    signedAttemptId: input.attempt.recordId,
    extrinsicHash: input.attempt.signedExtrinsicHash,
    blockHash: input.anchor.blockHash,
    extrinsicIndex: input.extrinsicIndex,
    status: input.status ?? "unresolved",
    anchor: input.anchor,
    layers: input.layers,
    events: input.events,
    postconditions: input.postconditions,
    proposalAfter: input.proposalAfter ?? null,
    currentStateDrift: input.currentStateDrift ?? false,
    evidence: input.evidence,
    derivedFromRecordDigest: null,
    operationId: input.envelope.intent.operationId,
    signingPath: input.envelope.signingPath,
    operationPhase: input.operationPhase,
    businessEffect: input.businessEffect ?? "unknown",
    causalBusinessContext: input.causalBusinessContext,
    targetProposalAfter: input.targetProposalAfter ?? null,
  };
  const sealed = await sealRecord(record);
  requireRecord(sealed);
  return sealed;
}
