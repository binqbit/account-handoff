import type { DedotClient } from "dedot";
import type { SignerPayloadJSON } from "dedot/types";

export type Hex = `0x${string}`;
export type NativeTx = ReturnType<DedotClient["toTx"]>;
export type Weight = { refTime: bigint; proofSize: bigint };
export type Timepoint = { height: number; index: number };
export type NativeAction =
  | { kind: "transfer"; destination: string; amount: bigint }
  | { kind: "create-pure"; index: number }
  | { kind: "map-account" }
  | { kind: "add-proxy" | "remove-proxy"; delegate: string }
  | { kind: "proxy"; beneficiary: string; inner: NativeAction }
  | {
      kind: "revive-call";
      destination: Hex;
      value: bigint;
      weight: Weight;
      storage: bigint;
      data: Hex;
    }
  | {
      kind: "multisig";
      threshold: number;
      others: string[];
      timepoint: Timepoint | undefined;
      inner: NativeAction;
      weight: Weight;
    }
  | {
      kind: "cancel";
      threshold: number;
      others: string[];
      timepoint: Timepoint;
      callHash: Hex;
    }
  | { kind: "vest-other"; beneficiary: string };

export interface NativeFingerprint {
  genesis: Hex;
  specName: string;
  specVersion: number;
  transactionVersion: number;
  metadataVersion: number;
  metadataHash: Hex;
  metadataSha256: string;
  rawMetadata: Hex;
  runtimeCodeHash: Hex;
  signedExtensions: string[];
  runtimeApis: Record<string, number>;
  anchor: { hash: Hex; number: number };
  tokenDecimals: number;
  tokenSymbol: string;
  ss58Prefix: number;
  metadataBinding?: "pinned-runtime-code" | "unbound-client-cache";
  metadataSourceAnchor?: { blockHash: Hex; blockNumber: number };
}
export interface NativeMetadataBinding {
  genesis: Hex;
  specVersion: number;
  runtimeCodeHash: Hex;
  metadataSha256: string;
  rawMetadata: Hex;
  sourceAnchor: { blockHash: Hex; blockNumber: number };
}
export interface NativeMetadataCapture {
  genesis: Hex;
  blockHash: Hex;
  blockNumber: number;
  finalized: true;
  /** Runtime code serving the Metadata API in this block's post-state. */
  runtimeCodeHash: Hex;
  specName: string;
  specVersion: number;
  transactionVersion: number;
  metadataVersion: number;
  metadataSha256: string;
  metadataHash: Hex;
  rawMetadata: Hex;
}
export interface NativeAccountState {
  address: Hex;
  free: bigint;
  reserved: bigint;
  frozen: bigint;
  nonce: number;
  proxies: { delegate: Hex; proxyType: string; delay: number }[];
  proxyDeposit: bigint;
  mappedAddress: Hex;
  mappedTo: Hex | null;
  holds: unknown;
  vesting: unknown;
  namedReserves?: unknown;
}
export interface NativeEvent {
  pallet: string;
  name: string;
  data: Record<string, unknown>;
  index: number;
}
export interface NativeReceipt {
  txHash: Hex;
  blockHash: Hex;
  blockNumber: number;
  txIndex: number;
  events: NativeEvent[];
  outerSuccess: boolean;
  nestedSuccess: boolean;
  businessExecuted: boolean;
  failure: string | null;
}
export interface PreparedSigning {
  payload: SignerPayloadJSON;
  rawPayload: Hex;
  callHex: Hex;
  callHash: Hex;
  signer: Hex;
  extra: unknown[];
  encodedExtra: Hex;
  additionalSigned: Hex;
  fingerprint: NativeFingerprint;
  createdAt: number;
}
