import type {
  ApiBinding,
  BindingEvidence,
  ChainProfile,
  EvidenceRef,
  FrozenEnvelope,
  GateRecord,
  ReviewedSigningContext,
  Snapshot,
} from "@account-handoff/contracts";
import type { FreshOperationInput } from "@account-handoff/domain";
import type { WalletSession } from "@account-handoff/wallet-adapter";

/** Emitted only by the LOCAL source/probe runner, never by an imported evidence package. */
export interface LocalCapabilityManifest {
  format: "account-handoff-local-capabilities-v1";
  runId: string;
  generation: number;
  genesisHash: string;
  metadataSha256: string;
  runtimeCodeHash: string;
  generatedNativeTypesSha256: string;
  apiSource?: { trait: EvidenceRef[]; implementation: EvidenceRef[] };
  currency?: {
    composition: "shared-balances-with-reason-holds";
    nativeToEthRatio: "10000";
    nativeDecimals: number;
    evidence: EvidenceRef[];
  };
  mapping?: {
    algorithm: "keccak256-last20";
    autoMap: false;
    originalAccount: "persisted-native-account";
    evidence: EvidenceRef[];
  };
  vesting?: {
    clock: "native-block-number";
    precompile: "0x0000000000000000000000000000000009020000";
    sourceEvidence: EvidenceRef[];
    nativeReleaseEvidence: EvidenceRef[];
  };
  adapter?: {
    dedot: "1.4.0";
    viem: "2.40.3";
    transport: "legacy";
    packageLockSha256: string;
    packageEvidence: EvidenceRef[];
    verificationEvidence: EvidenceRef[];
  };
  receipts?: {
    correlation: "finalized-block-extrinsic-index-and-whole-byte-hash";
    nestedFailures: "proxy-and-multisig-inspected";
    successEvidence: EvidenceRef[];
    failureEvidence: EvidenceRef[];
  };
}
export interface LocalQualificationResult {
  status: ChainProfile["status"];
  apiBindings: ApiBinding[];
  gateRecords: GateRecord[];
  sourceEvidence: EvidenceRef[];
  bindingEvidence: Partial<BindingEvidence>;
  mappingConfigurationEvidence: EvidenceRef[];
}
export interface PreparationSnapshotInput {
  profile: ChainProfile;
  snapshot: Snapshot;
  envelope: FrozenEnvelope;
  freshInput: FreshOperationInput;
  signingContext: ReviewedSigningContext;
  wallet: Pick<WalletSession, "source" | "version" | "accounts"> | null;
}
