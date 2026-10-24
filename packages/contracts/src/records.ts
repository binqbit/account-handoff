/** Finite wire declarations corresponding to grc-v2-local-1. Runtime validation enforces conditional schema constraints. */

export type Decimal = string;

export type Sha256 = string;

export type Hash32 = string;

export type AccountId32 = string;

export type H160 = string;

export type HexBytes = string;

export type DataValue = string | boolean | null | DataValue[] | DataObject;
export interface DataObject {
  [key: string]: DataValue;
}

export type EvidenceRef = {
  kind: "source" | "local_artifact" | "native_chain" | "author_published";
  locator: string;
  sourceId: string | null;
  contentSha256: Sha256 | null;
};

export type Weight = { refTime: Decimal; proofSize: Decimal };

export type ReadAnchor = {
  blockHash: Hash32;
  blockNumber: Decimal;
  finalized: true;
  executionRuntimeId: string;
  postStateRuntimeId: string;
  apiRuntimeId: string;
  providerId: string;
  contextBindings: {
    execution: RuntimeContext;
    postState: RuntimeContext;
    runtimeApi: RuntimeContext;
  };
};

export type Timepoint = {
  height: Decimal;
  index: Decimal;
  clockDomain: string;
};

export type Controller = {
  account: AccountId32;
  members: Array<AccountId32>;
  threshold: "2";
  role: "M0" | "M1";
};

export type VestingTuple = {
  locked: Decimal;
  perBlock: Decimal;
  startingBlock: Decimal;
  clockDomain: string;
};

export type Observation = {
  availability: "observed" | "absent" | "unavailable" | "not_requested";
  value: DataValue;
  anchor: ReadAnchor | null;
  decoderId: string | null;
  evidence: Array<EvidenceRef>;
  errorCode: string | null;
};

export type GateRecord = {
  id: GateId;
  status: "not_qualified" | "accepted" | "blocked" | "stale";
  evidence: Array<EvidenceRef>;
  reason: string;
  stage:
    | "profile_capability"
    | "action_input"
    | "finalized_output"
    | "product_release";
  subject: string;
  anchor: ReadAnchor | null;
};

export type ApiBinding = {
  name: string;
  version: Decimal;
  status: "unknown" | "source_candidate" | "qualified";
  codecArtifactSha256: Sha256 | null;
  sourceEvidence: Array<EvidenceRef>;
  boundRuntimeCodeHash: Hash32 | null;
  boundMetadataSha256: Sha256 | null;
  methodManifestSha256: Sha256 | null;
  traitSourceEvidence: Array<EvidenceRef>;
  runtimeImplementationEvidence: Array<EvidenceRef>;
  methods: Array<ApiMethodBinding>;
};

export type CallTree =
  | Tree_Transfer
  | Tree_CreatePure
  | Tree_MapAccount
  | Tree_AddProxy
  | Tree_RemoveProxy
  | Tree_Vest
  | Tree_VestOther
  | Tree_Cancel
  | Tree_AbiCreate
  | Tree_AbiSubmit
  | Tree_AbiApprove
  | Tree_AbiReclaim
  | Tree_ReviveCreate
  | Tree_ReviveSubmit
  | Tree_ReviveApprove
  | Tree_ReviveReclaim
  | Tree_ProxyMap
  | Tree_ProxyAdd
  | Tree_ProxyRemove
  | Tree_ProxySubmit
  | Tree_ProxyVest;

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

export type ChainProfile = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "ChainProfile";
  profileId: string;
  revision: Decimal;
  status: "candidate" | "accepted" | "blocked" | "stale";
  genesis: Hash32 | null;
  specName: string | null;
  specVersion: Decimal | null;
  transactionVersion: Decimal | null;
  runtimeCodeHash: Hash32 | null;
  metadataSha256: Sha256 | null;
  metadataVersion: Decimal | null;
  transport: "dedot_explicit_legacy";
  accountClass: "normal_non_EE_suffixed_AccountId32";
  apiBindings: Array<ApiBinding>;
  signedExtensions: Array<string>;
  gateRecords: Array<GateRecord>;
  sourceEvidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  firstBuildMode: "CONTROLLED_SINGLE_ROUND_DEMONSTRATOR";
  grantPolicyId: "vestry-single-round-demo-v1";
  mappingPolicy: MappingPolicy;
  bindingEvidence: BindingEvidence;
  localContractRevision: "grc-v2-local-1";
};

export type Snapshot = {
  schemaVersion: "2";
  recordId: string;
  digest: Sha256;
  kind: "Snapshot";
  profileId: string;
  anchor: ReadAnchor;
  completeness: "complete" | "incomplete";
  pure: AccountId32 | null;
  observations: Record<string, Observation>;
  sourceEvidence: Array<EvidenceRef>;
  derivedFromRecordDigest: Sha256 | null;
  profileDigest: Sha256;
  grantScope: GrantFlowScope;
  mapping: Array<MappingObservation>;
  accounting: AccountingLedger | null;
  authority: AuthorityObservation;
  gateAssessments: Array<GateRecord>;
  localContractRevision: "grc-v2-local-1";
};

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

export type GateId =
  | "Q-RUNTIME"
  | "Q-CURRENCY"
  | "Q-MAPPING"
  | "Q-REVIVE-API"
  | "Q-VESTING"
  | "Q-CONTRACT"
  | "Q-ADAPTER"
  | "Q-WALLET"
  | "Q-RECEIPTS"
  | "Q-INVENTORY"
  | "Q-FUNDING"
  | "Q-READINESS"
  | "Q-CONTINUITY"
  | "Q-USABILITY"
  | "Q-GRANT-SCOPE";

export type SignedDecimal = string;

export type ParticipantBindings = {
  A: AccountId32;
  B: AccountId32;
  C: AccountId32;
  D: AccountId32;
  F: AccountId32;
  R1: AccountId32;
  R2: AccountId32;
  S: AccountId32;
};

export type RuntimeContext = {
  contextId: string;
  genesis: Hash32;
  runtimeCodeHash: Hash32;
  metadataSha256: Sha256;
  specVersion: Decimal;
  transactionVersion: Decimal;
  metadataVersion: Decimal;
  apiCodecArtifactSha256: Sha256 | null;
  rawEvidence: Array<EvidenceRef>;
};

export type ApiMethodBinding = {
  methodName: string;
  rpcMethodName: string;
  canonicalSignature: string;
  inputCodecArtifactSha256: Sha256;
  outputCodecArtifactSha256: Sha256;
  typeRegistrySha256: Sha256;
  sourceEvidence: Array<EvidenceRef>;
};

export type MappingPolicy = {
  supportedBranch: "normal_non_EE_suffixed_AccountId32";
  autoMap: false;
  explicitMappingRequired: true;
  statelessEEBranchSupported: false;
  reviveOriginRoles: ["P", "F", "R1", "R2"];
  controllerOrMemberMappingRequiredForNativeWrapper: false;
  unmappingEnabled: false;
  qualifiedConfigurationEvidence: Array<EvidenceRef>;
};

export type BindingEvidence = {
  metadataHashConvention: "SHA256_of_exact_SCALE_metadata_bytes_without_RPC_hex_text";
  runtimeCodeHashConvention: "BLAKE2_256_of_exact_runtime_code_storage_bytes";
  rawMetadataEvidence: EvidenceRef | null;
  rawRuntimeCodeEvidence: EvidenceRef | null;
  runtimeSourceBuildRelationship: EvidenceRef | null;
  generatedNativeTypesSha256: Sha256 | null;
  abiSha256: Sha256 | null;
  contractAddress: H160 | null;
  contractRuntimeCodeHash: Hash32 | null;
  contractCodeHashConvention: "must_be_declared_and_qualified_in_contract_artifact_evidence";
  contractSourceBuildRelationship: EvidenceRef | null;
  packageLockSha256: Sha256 | null;
  packageArtifactEvidence: Array<EvidenceRef>;
  installedWalletEvidence: Array<EvidenceRef>;
};

export type GrantFlowScope = {
  policyId: "vestry-single-round-demo-v1";
  status:
    | "Unverified"
    | "EligibleSingleRound"
    | "ReconciliationRequired"
    | "ScopeBreached"
    | "Closed";
  grantId: Decimal | null;
  observedRounds: Array<Decimal>;
  historyComplete: boolean;
  blockingReasons: Array<string>;
  causalEvidence: Array<EvidenceRef>;
  reconciliationDigest: Sha256 | null;
  futureExternalActionsPrevented: false;
};

export type MappingObservation = {
  role: "P" | "F" | "R1" | "R2";
  account: AccountId32;
  h160: H160;
  branch: "normal_non_EE" | "stateless_EE" | "unknown";
  status:
    | "verified"
    | "absent"
    | "conflicting"
    | "unavailable"
    | "unsupported_branch";
  originalAccountEntry: AccountId32 | null;
  effectiveReverseAccount: AccountId32 | null;
  mappingHoldNative: Decimal | null;
  anchor: ReadAnchor;
  evidence: Array<EvidenceRef>;
};

export type ReserveReason = {
  reason: string;
  amountNative: Decimal;
  evidence: Array<EvidenceRef>;
};

export type AccountingLedger = {
  status: "reconciled" | "incomplete" | "conflicted";
  pure: AccountId32;
  creator: AccountId32;
  anchor: ReadAnchor;
  proxyDepositRecordedNative: Decimal;
  creatorHistoricalDepositNative: Decimal;
  creatorCurrentAggregateReservedNative: Decimal | null;
  pureProxyIncrementNative: Decimal;
  pureFreeNative: Decimal;
  pureReservedNative: Decimal;
  pureFrozenNative: Decimal;
  pureReasonHolds: Array<ReserveReason>;
  pureNamedReserves: Array<ReserveReason>;
  pureOtherTracedReservedLiabilitiesNative: Decimal;
  pureBackedLiabilitiesNative: Decimal;
  unexplainedReservedDeltaNative: SignedDecimal;
  constantSetDigest: Sha256;
  creationProvenance: Array<EvidenceRef>;
  adjustmentProvenance: Array<EvidenceRef>;
  creatorDepositAutomaticallyRefunded: false;
  totalBalanceOnHoldAddedAgain: false;
};

export type ProxyTuple = {
  delegate: AccountId32;
  proxyType: "Any";
  delay: "0";
};

export type AuthorityObservation = {
  state:
    | "NotCreated"
    | "M0Only"
    | "DualControl"
    | "M1Only"
    | "UnexpectedSet"
    | "Unknown";
  fullInventoryObserved: boolean;
  tuples: Array<ProxyTuple>;
  unsupportedTuplesRaw: Array<DataValue>;
  evidence: Array<EvidenceRef>;
};

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

export type Tree_Transfer = {
  kind: "native_call";
  palletOrContract: "Balances";
  method: "transfer_keep_alive";
  parameters: { dest: AccountId32; valueNative: Decimal };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_CreatePure = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "create_pure";
  parameters: { proxyType: "Any"; delay: "0"; index: Decimal };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_MapAccount = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "map_account";
  parameters: {};
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AddProxy = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "add_proxy";
  parameters: { delegate: AccountId32; proxyType: "Any"; delay: "0" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_RemoveProxy = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "remove_proxy";
  parameters: { delegate: AccountId32; proxyType: "Any"; delay: "0" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_Vest = {
  kind: "native_call";
  palletOrContract: "Vesting";
  method: "vest";
  parameters: {};
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_VestOther = {
  kind: "native_call";
  palletOrContract: "Vesting";
  method: "vest_other";
  parameters: { target: AccountId32 };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_Cancel = {
  kind: "native_call";
  palletOrContract: "Multisig";
  method: "cancel_as_multi";
  parameters: {
    threshold: "2";
    otherSignatories: Array<AccountId32>;
    timepoint: Timepoint;
    callHash: Hash32;
  };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiCreate = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "createGrant(address,address,address[],uint8,(uint128,uint64,uint32,address,bytes4,uint64)[])";
  parameters: {
    grantee: H160;
    token: "0x0000000000000000000000000000000000000000";
    reviewers: Array<H160>;
    threshold: "2";
    inputs: [MilestoneInput, MilestoneInput];
  };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiSubmit = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "submitMilestone(uint256,uint256,string)";
  parameters: { grantId: Decimal; index: "0" | "1"; evidence: string };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiApprove = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "approveMilestone(uint256,uint256)";
  parameters: { grantId: Decimal; index: "0" | "1" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiReclaim = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "reclaim(uint256,uint256)";
  parameters: { grantId: Decimal; index: "0" | "1" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveCreate = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiCreate>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveSubmit = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiSubmit>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveApprove = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiApprove>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveReclaim = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiReclaim>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyMap = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_MapAccount>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyAdd = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_AddProxy>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyRemove = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_RemoveProxy>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxySubmit = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_ReviveSubmit>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyVest = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_Vest>;
  sourceEvidence: Array<EvidenceRef>;
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

export type PositiveDecimal = string;

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

export const CONTRACT_REVISION = "grc-v2-local-1" as const;
