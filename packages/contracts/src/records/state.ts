/** Observed grant, mapping, authority and reserve state at a native checkpoint. */
import type {
  AccountId32,
  DataValue,
  Decimal,
  EvidenceRef,
  H160,
  Sha256,
  SignedDecimal,
} from "./primitives.js";
import type { GateRecord, Observation, ReadAnchor } from "./runtime.js";

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
