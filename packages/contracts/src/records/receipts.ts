/** Finalized dispatch layers, events and causal business result records. */
import type {
  DataValue,
  Decimal,
  EvidenceRef,
  H160,
  Hash32,
  HexBytes,
  Sha256,
} from "./primitives.js";
import type { ReadAnchor } from "./runtime.js";
import type { EnabledOperationId } from "./intents.js";

export type LayerResult = {
  layer: "System" | "Multisig" | "Proxy" | "Revive" | "Contract" | "Vesting";
  pathOrdinal: Decimal;
  result: "success" | "failure" | "unavailable" | "not_applicable";
  eventIndices: Array<Decimal>;
  error: string | null;
  revertBytes: HexBytes | null;
};

export type EventRecord = {
  nativeEventIndex: Decimal;
  extrinsicIndex: Decimal;
  pallet: string;
  event: string;
  contractEmitter: H160 | null;
  abiLogOrdinal: Decimal | null;
  rawEvidence: EvidenceRef;
  decoded: DataValue;
};

export type Postcondition = {
  id: string;
  result: "passed" | "failed" | "unknown";
  anchor: ReadAnchor | null;
  observations: Array<EvidenceRef>;
  explanation: string;
};

export type CausalBusinessContext = {
  assessment: "not_applicable" | "matched" | "mismatched" | "unresolved";
  grantId: Decimal | null;
  milestoneIndex: ("0" | "1") | null;
  roundAtIntendedEvent: Decimal | null;
  intendedEvidenceSha256: Sha256 | null;
  nativeEventIndex: Decimal | null;
  abiLogOrdinal: Decimal | null;
  orderedHistoryComplete: boolean;
  eventOrderEvidence: Array<EvidenceRef>;
};

export type ReceiptBundle = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "ReceiptBundle";
  intentId: string;
  profileId: string;
  signedAttemptId: string;
  extrinsicHash: Hash32;
  blockHash: Hash32;
  extrinsicIndex: Decimal;
  status:
    | "provisional"
    | "finalized_success"
    | "finalized_failure"
    | "unresolved"
    | "retracted";
  anchor: ReadAnchor | null;
  layers: Array<LayerResult>;
  events: Array<EventRecord>;
  postconditions: Array<Postcondition>;
  proposalAfter: ("present" | "consumed" | "absent" | "unknown") | null;
  currentStateDrift: boolean;
  evidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  profileDigest: Sha256;
  operationId: EnabledOperationId;
  signingPath: "direct" | "multisig_direct" | "multisig_proxy";
  operationPhase: "direct" | "multisig_first" | "multisig_final" | "cancel";
  businessEffect:
    | "not_attempted"
    | "historically_verified"
    | "failed"
    | "unknown"
    | "context_mismatch"
    | "configuration_diverged";
  causalBusinessContext: CausalBusinessContext;
  targetProposalAfter:
    ("present" | "cancelled" | "absent_unexplained" | "unknown") | null;
  localContractRevision: "grc-v2-local-1";
};
