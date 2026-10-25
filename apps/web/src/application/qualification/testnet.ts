import {
  canonicalJson,
  sha256,
  type ApiBinding,
  type EvidenceRef,
  type GateId,
} from "@account-handoff/contracts";
import {
  type NativeConnection,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import { $Metadata } from "dedot/codecs";
import { blake2AsHex } from "dedot/utils";
import type { TestnetDescriptor } from "../network-descriptor";
import type { LocalQualificationResult } from "./types";
import { verifyContractAt } from "../local-import";

/** Qualification of this pinned public runtime, independently from LOCAL source manifests. */
export async function buildTestnetQualification(
  d: TestnetDescriptor,
  f: NativeFingerprint,
  connection: NativeConnection,
): Promise<
  LocalQualificationResult & {
    mappingPolicy: import("@account-handoff/contracts").MappingPolicy;
  }
> {
  const binding = d.nativeMetadataBinding;
  const identity =
    f.genesis === d.genesisHash &&
    f.runtimeCodeHash === d.runtimeCodeHash &&
    f.metadataSha256 === d.metadataSha256 &&
    f.rawMetadata === binding.rawMetadata &&
    f.specName === d.runtime.specName &&
    f.specVersion === d.runtime.specVersion &&
    f.metadataBinding === "pinned-runtime-code" &&
    f.tokenDecimals === 14;
  const raw: EvidenceRef = {
    kind: "native_chain",
    locator: `native:${f.genesis}:${binding.sourceAnchor.blockHash}:metadata`,
    sourceId: f.runtimeCodeHash,
    contentSha256: f.metadataSha256,
  };
  const code: EvidenceRef = {
    kind: "native_chain",
    locator: `native:${f.genesis}:runtime-code:${f.runtimeCodeHash}`,
    sourceId: f.runtimeCodeHash,
    contentSha256: null,
  };
  const evidence = [raw, ...(d.verification ? [d.verification.evidence] : [])];
  const proof =
    d.verification?.runtimeCodeHash === f.runtimeCodeHash &&
    d.verification.metadataSha256 === f.metadataSha256 &&
    /^[0-9a-f]{64}$/.test(d.verification.evidence.contentSha256 ?? "");
  const verified = (capability: string) =>
    identity && proof && d.verification!.capabilities.includes(capability);
  const result: LocalQualificationResult & {
    mappingPolicy: import("@account-handoff/contracts").MappingPolicy;
  } = {
    status: identity ? "accepted" : "candidate",
    apiBindings: [],
    gateRecords: [],
    sourceEvidence: evidence,
    mappingConfigurationEvidence: evidence,
    mappingPolicy: {
      supportedBranch: "normal_non_EE_suffixed_AccountId32",
      autoMap: true,
      explicitMappingRequired: false,
      statelessEEBranchSupported: false,
      reviveOriginRoles: ["P", "F", "R1", "R2"],
      controllerOrMemberMappingRequiredForNativeWrapper: false,
      unmappingEnabled: false,
      qualifiedConfigurationEvidence: evidence,
    },
    bindingEvidence: {
      rawMetadataEvidence: raw,
      rawRuntimeCodeEvidence: code,
      runtimeArtifactVerification: proof ? d.verification!.evidence : null,
      runtimeSourceBuildRelationship: null,
      generatedNativeTypesSha256: null,
      packageLockSha256: proof ? d.verification!.packageLockSha256 : null,
      packageArtifactEvidence: proof ? [d.verification!.evidence] : [],
      abiSha256: d.contract.abiSha256,
      contractAddress: d.contract.address,
      contractRuntimeCodeHash: d.contract.runtimeCodeHash,
      contractSourceBuildRelationship: {
        kind: "local_artifact",
        locator: "contracts/artifacts/Vestry.json",
        sourceId: d.contract.sourceSha256,
        contentSha256: d.contract.abiSha256,
      },
    },
  };
  const gate = (id: GateId, accepted: boolean, reason: string) =>
    result.gateRecords.push({
      id,
      status: accepted ? "accepted" : "not_qualified",
      stage: "profile_capability",
      subject:
        "Pinned PortalDot V3 runtime; local fork verification is not testnet execution",
      anchor: null,
      evidence: accepted ? evidence : [],
      reason,
    });
  gate(
    "Q-RUNTIME",
    identity && !!proof,
    "Exact runtime/metadata must match the independently verified runtime artifact.",
  );
  const c = connection.api.consts;
  gate(
    "Q-CURRENCY",
    verified("currency") &&
      BigInt(c.revive.nativeToEthRatio) === 10000n &&
      c.balances.existentialDeposit > 0n,
    "Native denomination and reserve accounting verified against this runtime.",
  );
  gate(
    "Q-MAPPING",
    verified("automatic-mapping") && c.revive.autoMap === true,
    "Automatic mapping is runtime-verified; each account still requires a fresh persisted reverse mapping.",
  );
  gate(
    "Q-VESTING",
    verified("vesting") && c.vesting.minVestedTransfer === 10n ** 15n,
    "Native vesting precompile, minimum and maintenance verified on the exact runtime artifact.",
  );
  gate(
    "Q-ADAPTER",
    verified("native-codec") && verified("signing"),
    "Pinned SDK call encoding and real signature verification passed in the isolated runtime fork.",
  );
  gate(
    "Q-RECEIPTS",
    verified("receipts") && verified("proxy-multisig"),
    "Nested success/failure and canonical extrinsic correlation verified in the isolated runtime fork.",
  );
  let contract = false;
  if (identity) {
    await verifyContractAt(
      connection,
      d.contract.address,
      d.contract.runtimeCodeHash,
      f.anchor.hash,
    );
    contract = true;
  }
  gate(
    "Q-CONTRACT",
    contract,
    "Live finalized code matches the unchanged pinned Vestry deployment.",
  );
  const metadata = $Metadata.tryDecode(f.rawMetadata).latest;
  const api = metadata.apis.find((a) => a.name === "ReviveApi");
  const id = blake2AsHex(new TextEncoder().encode("ReviveApi"), 64);
  const apiOk =
    verified("revive-api") &&
    f.runtimeApis[id] === 2 &&
    api &&
    ["call", "address", "account_id"].every((name) =>
      api.methods.some((method) => method.name === name),
    );
  if (apiOk) {
    const methods: ApiBinding["methods"] = api.methods.map((method) => ({
      methodName: method.name,
      rpcMethodName: `ReviveApi_${method.name}`,
      canonicalSignature: `ReviveApi.${method.name}(${method.inputs.map((arg) => `${arg.name}:scaleType(${arg.typeId})`).join(",")})->scaleType(${method.output})@${f.metadataSha256}`,
      inputCodecArtifactSha256: f.metadataSha256,
      outputCodecArtifactSha256: f.metadataSha256,
      typeRegistrySha256: f.metadataSha256,
      sourceEvidence: [raw],
    }));
    result.apiBindings.push({
      name: "ReviveApi",
      version: "2",
      status: "qualified",
      codecArtifactSha256: f.metadataSha256,
      sourceEvidence: evidence,
      boundRuntimeCodeHash: f.runtimeCodeHash,
      boundMetadataSha256: f.metadataSha256,
      methodManifestSha256: await sha256(canonicalJson(methods)),
      traitSourceEvidence: [raw],
      runtimeImplementationEvidence: [code, ...evidence],
      methods,
    });
  }
  gate(
    "Q-REVIVE-API",
    !!apiOk,
    "Exact advertised API version, metadata codecs and runtime calls must match.",
  );
  if (result.gateRecords.some((g) => g.status !== "accepted"))
    result.status = "candidate";
  return result;
}
