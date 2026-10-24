/** Closed operation vocabulary, parameters, expected state and resource bounds. */
import type {
  AccountId32,
  Controller,
  DataValue,
  Decimal,
  EvidenceRef,
  H160,
  Hash32,
  HexBytes,
  PositiveDecimal,
  Sha256,
  Timepoint,
  Weight,
} from "./primitives.js";

export type MilestoneInput = {
  amount: Decimal;
  deadline: Decimal;
  vestingBlocks: Decimal;
  metricTarget: "0x0000000000000000000000000000000000000000";
  metricSelector: "0x00000000";
  metricMin: "0";
};

export type EnabledOperationId =
  | "GRC-SETUP-FUND-M0"
  | "GRC-SETUP-FUND-ACTOR"
  | "GRC-SETUP-CREATE-PURE"
  | "GRC-SETUP-FUND-P"
  | "GRC-SETUP-MAP-P"
  | "GRC-SETUP-MAP-ACTOR"
  | "GRC-GRANT-CREATE"
  | "GRC-GRANT-SUBMIT-M0"
  | "GRC-GRANT-SUBMIT-M1"
  | "GRC-GRANT-APPROVE"
  | "GRC-ROTATION-ADD-M1"
  | "GRC-ROTATION-REMOVE-M0"
  | "GRC-VESTING-VEST-OTHER"
  | "GRC-MULTISIG-CANCEL";

export type GrantContext = {
  grantId: Decimal;
  milestoneIndex: "0" | "1";
  observedRound: Decimal;
  reviewedExpectedRound: "0" | null;
  roundBinding: "client_review_only_not_ABI_enforced";
  observedMilestoneState: "Open" | "Submitted" | "Released" | "Reclaimed";
  deadlineUnixSeconds: Decimal;
  evidenceSha256: Sha256 | null;
  scopeStatus:
    | "EligibleSingleRound"
    | "ReconciliationRequired"
    | "ScopeBreached"
    | "Closed"
    | "Unverified";
  historyComplete: boolean;
  evidence: Array<EvidenceRef>;
};

export type ExpectedState = {
  snapshotDigest: Sha256;
  authority:
    "NotCreated" | "M0Only" | "DualControl" | "M1Only" | "NotApplicable";
  grantContext: GrantContext | null;
  localReviewExpiresAtUnixSeconds: Decimal;
  localExpiryRevokesNativeProposal: false;
};

export type Intent = {
  intentId: string;
  operationId: EnabledOperationId;
  profileId: string;
  authorActor: string;
  parameters: Record<string, DataValue>;
  expectedState: ExpectedState;
  supersedesIntentId: string | null;
  profileDigest: Sha256;
  intentRevision: PositiveDecimal;
};

export type ResourceBounds = {
  valueNative: Decimal;
  reviveWeight: Weight | null;
  storageDepositLimitNative: Decimal | null;
  multisigInnerMaxWeight: Weight | null;
  outerFeeEstimateNative: Decimal | null;
  outerFeeLocalBudgetNative: Decimal | null;
  feeBudgetIsChainEnforcedCap: false;
  estimationEvidence: Array<EvidenceRef>;
};

export type Params_GRC_SETUP_FUND_M0 = {
  recipient: AccountId32;
  valueNative: Decimal;
};

export type Params_GRC_SETUP_FUND_ACTOR = {
  recipientRole: "A" | "B" | "D" | "F" | "R1" | "R2";
  recipient: AccountId32;
  valueNative: Decimal;
};

export type Params_GRC_SETUP_CREATE_PURE = {
  pureIndex: Decimal;
  proxyType: "Any";
  delay: "0";
};

export type Params_GRC_SETUP_FUND_P = {
  pure: AccountId32;
  valueNative: Decimal;
};

export type Params_GRC_SETUP_MAP_P = { pure: AccountId32 };

export type Params_GRC_SETUP_MAP_ACTOR = {
  actorRole: "F" | "R1" | "R2";
  account: AccountId32;
};

export type Params_GRC_GRANT_CREATE = {
  contract: H160;
  granteeH160: H160;
  token: "0x0000000000000000000000000000000000000000";
  reviewers: Array<H160>;
  threshold: "2";
  milestones: [MilestoneInput, MilestoneInput];
};

export type Params_GRC_GRANT_SUBMIT_M0 = {
  contract: H160;
  grantId: Decimal;
  index: "0";
  evidence: string;
};

export type Params_GRC_GRANT_SUBMIT_M1 = {
  contract: H160;
  grantId: Decimal;
  index: "1";
  evidence: string;
};

export type Params_GRC_GRANT_APPROVE = {
  contract: H160;
  grantId: Decimal;
  index: "0" | "1";
};

export type Params_GRC_GRANT_RECLAIM = {
  contract: H160;
  grantId: Decimal;
  index: "0" | "1";
};

export type Params_GRC_ROTATION_ADD_M1 = {
  pure: AccountId32;
  oldController: AccountId32;
  newController: AccountId32;
  proxyType: "Any";
  delay: "0";
};

export type Params_GRC_ROTATION_REMOVE_M0 = {
  pure: AccountId32;
  oldController: AccountId32;
  newController: AccountId32;
  proxyType: "Any";
  delay: "0";
};

export type Params_GRC_VESTING_VEST = { pure: AccountId32 };

export type Params_GRC_VESTING_VEST_OTHER = { targetPure: AccountId32 };

export type Params_GRC_MULTISIG_CANCEL = {
  targetController: Controller;
  targetCallHash: Hash32;
  targetTimepoint: Timepoint;
  originalDepositor: AccountId32;
  targetEnvelopeDigest: Sha256 | null;
  originalTargetCallBytes: HexBytes | null;
};
