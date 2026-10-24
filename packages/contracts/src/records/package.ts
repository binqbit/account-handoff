/** The seven canonical record variants and their unsigned portable package. */
import type { ChainProfile } from "./runtime.js";
import type { Snapshot } from "./state.js";
import type {
  FrozenEnvelope,
  NativeProposal,
  SignedAttempt,
} from "./transactions.js";
import type { ReceiptBundle } from "./receipts.js";
import type { ContinuityCertificate } from "./continuity.js";
import type { EvidenceRef, Sha256 } from "./primitives.js";

export type CanonicalRecord =
  | ChainProfile
  | Snapshot
  | FrozenEnvelope
  | NativeProposal
  | SignedAttempt
  | ReceiptBundle
  | ContinuityCertificate;

export type PortablePackage = {
  format: "grc.native-record-package";
  version: "2";
  scope: "portable_unsigned_evidence";
  records: Array<CanonicalRecord>;
  recordIdentityMap: Array<{
    oldRecordId: string;
    oldDigest: Sha256;
    newRecordId: string;
    newDigest: Sha256;
    reason: "signed_bytes_redaction" | "reference_remap";
  }>;
  sourceInputs: Array<EvidenceRef>;
  localContractRevision: "grc-v2-local-1";
};
