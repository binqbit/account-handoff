import type { KeyringPair } from "@polkadot/keyring/types";
import type {
  Hex,
  NativeAction,
  NativeReceipt,
  NativeAccountState,
  NativeConnection,
  NativeFingerprint,
} from "@account-handoff/native-adapter";
export type Role = "A" | "B" | "C" | "D" | "F" | "R1" | "R2" | "X";
export type Step = {
  status: "prepared" | "signed" | "broadcast-unknown" | "finalized";
  startBlock: number;
  actor: Role;
  callHash: Hex;
  prepared: unknown;
  action: unknown;
  signedBytes?: Hex;
  txHash?: Hex;
  receipt?: NativeReceipt;
  expectedFailure?: boolean;
  error?: string;
};
export interface Session {
  formatVersion: 1;
  mode: "LOCAL";
  runId: string;
  generation: number;
  genesis: Hex;
  contract: Hex;
  actors: Record<Role, Hex>;
  m0: Hex;
  m1: Hex;
  p?: Hex;
  grantId?: string;
  steps: Record<string, Step>;
  baseline?: unknown;
  rotation?: unknown;
  continuation?: unknown;
  dualControl?: unknown;
  cancellationProbe?: { reservedBefore: string; callHash: Hex };
  maintenance?: unknown;
  mappingProbe?: {
    address: Hex;
    initiallyUnmapped: true;
    reservedBefore: string;
    receiptHash?: Hex;
    result?: unknown;
  };
  operations: Record<
    string,
    {
      inner: unknown;
      callHash: Hex;
      weight: { refTime: string; proofSize: string };
    }
  >;
  fixture?: { deadline: string };
}

export type LocalAction =
  "seed" | "handoff" | "inspect" | "negative" | "reconcile";
export interface LocalRun {
  owner: string;
  mode: string;
  runId: string;
  generation: number;
  nativeRpc: string;
  status: string;
  genesisHash: Hex;
  qualification?: {
    status: string;
    generation: number;
    genesis: Hex;
    runtimeCodeHash: Hex;
    metadataSha256: string;
  };
}
export interface LocalActors {
  pairs: Record<Role, KeyringPair>;
  actors: Record<Role, Hex>;
  m0: Hex;
  m1: Hex;
}
export interface LocalRuntime extends LocalActors {
  id: string;
  action: LocalAction;
  directory: string;
  run: LocalRun;
  sessionPath: string;
  session: Session;
  connection: NativeConnection;
  fingerprint: NativeFingerprint;
}
export interface NativeExecution {
  transact(
    name: string,
    actionInput: NativeAction | (() => Promise<NativeAction>),
    role: Role,
    expectedFailure?: boolean,
  ): Promise<NativeReceipt>;
  multisig(
    name: string,
    controller: Hex,
    members: Hex[],
    roles: [Role, Role],
    input: NativeAction | (() => Promise<NativeAction>),
    expectedFailure?: boolean,
  ): Promise<NativeReceipt>;
}
export interface NativeQueries {
  proxySet(
    p: Hex,
    expected: Hex[],
    blockHash?: Hex,
  ): Promise<NativeAccountState>;
  contractCall(origin: Hex, data: Hex, value?: bigint): Promise<NativeAction>;
  event(receipt: NativeReceipt, name: string): Record<string, unknown>;
}
export type ScenarioContext = LocalRuntime & NativeExecution & NativeQueries;
