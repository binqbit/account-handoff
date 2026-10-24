/** Preserved identity and the certificate binding removal to continuation. */
import type {
  AccountId32,
  Controller,
  Decimal,
  EvidenceRef,
  H160,
  Sha256,
  VestingTuple,
} from "./primitives.js";
import type { ReadAnchor } from "./runtime.js";
import type { GrantFlowScope } from "./state.js";

export type PreservedIdentity = {
  P: AccountId32;
  hP: H160;
  grantee: H160;
  reverseMappingAccount: AccountId32;
  milestone0Tuple: VestingTuple;
  tupleMultiplicity: Decimal;
  creationReceipt: EvidenceRef;
  grantId: Decimal;
  contractAddress: H160;
  mappingBranch: "normal_non_EE";
  originalAccountEntry: AccountId32;
  mappingEvidence: Array<EvidenceRef>;
  grantCreationReceipt: EvidenceRef;
};

export type ContinuityCertificate = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "ContinuityCertificate";
  profileId: string;
  verdict:
    | "verified"
    | "incomplete"
    | "failed"
    | "historically_verified_current_drift";
  before: ReadAnchor;
  after: ReadAnchor;
  identity: PreservedIdentity;
  M0: Controller;
  M1: Controller;
  removalReceiptId: string | null;
  milestone1SubmissionReceiptId: string | null;
  criteria: {
    pureIdentity: "passed" | "failed" | "unknown";
    h160Identity: "passed" | "failed" | "unknown";
    reverseMapping: "passed" | "failed" | "unknown";
    grantBeneficiary: "passed" | "failed" | "unknown";
    activeVestingTuple: "passed" | "failed" | "unknown";
    backing: "passed" | "failed" | "unknown";
    exactNewAuthority: "passed" | "failed" | "unknown";
    attributedMilestone1Submission: "passed" | "failed" | "unknown";
    removalQuorumAD: "passed" | "failed" | "unknown";
    continuationQuorumAD: "passed" | "failed" | "unknown";
    singleRoundBusinessContext: "passed" | "failed" | "unknown";
  };
  independentCustodyProven: boolean;
  BReadinessStatus: "demonstrated" | "declared_only" | "unknown";
  legalOrFunderConsentInferred: false;
  evidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  profileDigest: Sha256;
  grantScopeAtSubmission:
    | "EligibleSingleRound"
    | "Unverified"
    | "ScopeBreached"
    | "ReconciliationRequired";
  currentGrantScope: GrantFlowScope;
  removalParticipationEvidence: Array<EvidenceRef>;
  continuationParticipationEvidence: Array<EvidenceRef>;
  scopeOfProof: "anchor_specific_native_authority_and_attributed_next_submission_not_reviewer_payment_or_legal_consent";
  localContractRevision: "grc-v2-local-1";
};
