/** Reviewed envelopes, native proposals, signing context and local progress records. */
import type {
  AccountId32,
  Controller,
  Decimal,
  EvidenceRef,
  Hash32,
  HexBytes,
  ParticipantBindings,
  Sha256,
  Timepoint,
} from "./primitives.js";
import type { Intent, ResourceBounds } from "./intents.js";
import type { GateId, ReadAnchor } from "./runtime.js";
import type { CallTree } from "./calls.js";

export type FrozenEnvelope = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "FrozenEnvelope";
  intent: Intent;
  status: "draft" | "frozen" | "approved" | "stale" | "superseded";
  anchor: ReadAnchor;
  signingPath: "direct" | "multisig_proxy" | "multisig_direct";
  controller: Controller | null;
  requiredSigners: Array<AccountId32>;
  callTree: CallTree;
  innerRuntimeCallBytes: HexBytes | null;
  innerRuntimeCallHash: Hash32 | null;
  resources: ResourceBounds;
  summaryText: string;
  requiredGateIds: Array<GateId>;
  evidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  participants: ParticipantBindings;
  localContractRevision: "grc-v2-local-1";
  semanticIntentDigest: Sha256 | null;
};

export type NativeProposal = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "NativeProposal";
  profileId: string;
  multisig: AccountId32;
  innerCallHash: Hash32;
  state: "absent" | "present" | "executed_consumed" | "cancelled" | "unknown";
  timepoint: Timepoint | null;
  depositor: AccountId32 | null;
  approvals: Array<AccountId32>;
  depositNative: Decimal | null;
  anchor: ReadAnchor;
  evidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  profileDigest: Sha256;
  localContractRevision: "grc-v2-local-1";
};

export type ReviewedSigningContext = {
  requestId: string;
  walletBuildId: string;
  signer: AccountId32;
  genesis: Hash32;
  specVersion: Decimal;
  transactionVersion: Decimal;
  runtimeCodeHash: Hash32;
  metadataSha256: Sha256;
  signedExtensions: Array<string>;
  nonce: Decimal;
  era: HexBytes;
  mortalityBlockHash: Hash32;
  outerCallBytes: HexBytes;
  outerCallHash: Hash32;
  extrinsicVersion: Decimal;
  encodedExtraPayloadBytes: HexBytes;
  tipNative: Decimal;
  feeAssetId: null;
  metadataHashExtensionValue: Hash32 | null;
  originalSignPayloadJcsUtf8: string;
  additionalSignedPayloadBytes: HexBytes;
  signPayloadSha256: Sha256;
  additionalSignedContextSha256: Sha256;
  withSignedTransactionRequested: false;
  walletReturnedSignedTransactionAccepted: false;
  operationPhase: "direct" | "multisig_first" | "multisig_final" | "cancel";
  nativeProposalDigest: Sha256 | null;
};

export type SignedAttempt = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "SignedAttempt";
  intentId: string;
  envelopeDigest: Sha256;
  profileId: string;
  signer: AccountId32;
  nonce: Decimal;
  era: HexBytes;
  signedExtrinsicHash: Hash32;
  signedExtrinsicBytes: HexBytes | null;
  bytesOmissionReason: "portable_export_omits_all_signed_packets" | null;
  reviewedSigningContext: ReviewedSigningContext;
  signingContextSha256: Sha256;
  status:
    | "signed"
    | "broadcast"
    | "included"
    | "retracted"
    | "finalized"
    | "submission_unknown"
    | "invalid"
    | "dropped";
  observations: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  profileDigest: Sha256;
  recordScope: "local_journal" | "portable_export";
  localContractRevision: "grc-v2-local-1";
};

export type LocalOperationProgress = {
  journalVersion: "1";
  kind: "LocalOperationProgress";
  journalId: string;
  intentId: string;
  envelopeDigest: Sha256;
  requestId: string | null;
  phase:
    | "Prepared"
    | "WalletRequested"
    | "WalletRejected"
    | "GuardRefused"
    | "WalletOutcomeUnknown"
    | "SignedAttemptRecorded";
  profileId: string;
  profileDigest: Sha256;
  outerCallSha256: Sha256 | null;
  requestedSigner: AccountId32 | null;
  reviewedRequestDigest: Sha256 | null;
  requestedAtUnixSeconds: Decimal | null;
  acceptedSignedAttemptId: string | null;
  observations: Array<EvidenceRef>;
  portable: false;
  localContractRevision: "grc-v2-local-1";
  reviewedSigningContext: ReviewedSigningContext | null;
};
