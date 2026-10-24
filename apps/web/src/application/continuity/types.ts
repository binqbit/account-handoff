import type {
  AccountingLedger,
  CanonicalRecord,
  EvidenceRef,
  FrozenEnvelope,
  NativeProposal,
  ReceiptBundle,
  SignedAttempt,
} from "@account-handoff/contracts";
import type {
  Hex,
  NativeAccountState,
  NativeConnection,
  NativeFingerprint,
  NativeReceipt,
} from "@account-handoff/native-adapter";
import type { GrantHistory, GrantState } from "@account-handoff/grant-adapter";
import type { WorkspaceRecord } from "../models";

export interface InspectedExtrinsic {
  bytes: Hex;
  signer: string | null;
  call: unknown;
  callHex: Hex;
}
export interface EvidenceConnection {
  api: NativeConnection["api"];
  readAccount(address: string, blockHash?: Hex): Promise<NativeAccountState>;
  receiptAt(blockHash: Hex, transactionHash: Hex): Promise<NativeReceipt>;
  inspectExtrinsic(blockHash: Hex, index: number): Promise<InspectedExtrinsic>;
}
export interface WorkspaceCertificateInput {
  connection: EvidenceConnection;
  workspace: WorkspaceRecord;
  profile: Extract<CanonicalRecord, { kind: "ChainProfile" }>;
  beforeFingerprint: NativeFingerprint;
  afterFingerprint: NativeFingerprint;
  currentAccounts: Record<string, NativeAccountState>;
  currentGrant: GrantState;
  accounting: AccountingLedger;
  history: GrantHistory;
  records: CanonicalRecord[];
  verifiedReceipts?: Array<{ receipt: NativeReceipt; rawExtrinsic: Hex }>;
}
export interface ReceiptProof {
  receipt: ReceiptBundle;
  envelope: FrozenEnvelope;
  attempt: SignedAttempt;
  proposal: NativeProposal;
  participation: EvidenceRef[];
}
