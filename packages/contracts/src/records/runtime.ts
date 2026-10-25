/** Qualified runtime identity, read anchors and capability evidence. */
import type {
  DataValue,
  Decimal,
  EvidenceRef,
  H160,
  Hash32,
  Sha256,
} from "./primitives.js";

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

export type Observation = {
  availability: "observed" | "absent" | "unavailable" | "not_requested";
  value: DataValue;
  anchor: ReadAnchor | null;
  decoderId: string | null;
  evidence: Array<EvidenceRef>;
  errorCode: string | null;
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

export type ApiMethodBinding = {
  methodName: string;
  rpcMethodName: string;
  canonicalSignature: string;
  inputCodecArtifactSha256: Sha256;
  outputCodecArtifactSha256: Sha256;
  typeRegistrySha256: Sha256;
  sourceEvidence: Array<EvidenceRef>;
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

export type MappingPolicy = {
  supportedBranch: "normal_non_EE_suffixed_AccountId32";
  statelessEEBranchSupported: false;
  reviveOriginRoles: ["P", "F", "R1", "R2"];
  controllerOrMemberMappingRequiredForNativeWrapper: false;
  unmappingEnabled: false;
  qualifiedConfigurationEvidence: Array<EvidenceRef>;
} & (
  | { autoMap: false; explicitMappingRequired: true }
  | { autoMap: true; explicitMappingRequired: false }
);

export type BindingEvidence = {
  metadataHashConvention: "SHA256_of_exact_SCALE_metadata_bytes_without_RPC_hex_text";
  runtimeCodeHashConvention: "BLAKE2_256_of_exact_runtime_code_storage_bytes";
  rawMetadataEvidence: EvidenceRef | null;
  rawRuntimeCodeEvidence: EvidenceRef | null;
  runtimeSourceBuildRelationship: EvidenceRef | null;
  /** Exact deployed runtime executed in an isolated fork; does not assert source provenance. */
  runtimeArtifactVerification?: EvidenceRef | null;
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
