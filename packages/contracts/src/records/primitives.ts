/** Exact wire scalar aliases, identities and shared evidence references. */

export type Decimal = string;

export type SignedDecimal = string;

export type PositiveDecimal = string;

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

export type ParticipantBindings = {
  A: AccountId32;
  B: AccountId32;
  C: AccountId32;
  D: AccountId32 | null;
  F: AccountId32;
  R1: AccountId32;
  R2: AccountId32;
  S: AccountId32;
};
