import { canonicalJson, hexBytes, sha256 } from "@account-handoff/contracts";
import type {
  EvidenceRef,
  GateId,
  GateRecord,
} from "@account-handoff/contracts";
import type { NativeFingerprint } from "@account-handoff/native-adapter";
import { $Metadata } from "dedot/codecs";
import { blake2AsHex } from "dedot/utils";
import type { LocalDescriptor } from "../models";
import type { LocalQualificationResult } from "./types";

const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
function evidenced(value: EvidenceRef[] | undefined): value is EvidenceRef[] {
  return (
    !!value?.length &&
    value.every(
      (entry) => !!entry.locator && SHA.test(entry.contentSha256 ?? ""),
    )
  );
}
function sourceBound(
  value: EvidenceRef[] | undefined,
  commit: string,
): value is EvidenceRef[] {
  return evidenced(value) && value.every((entry) => entry.sourceId === commit);
}
function gate(
  id: GateId,
  accepted: boolean,
  evidence: EvidenceRef[],
  reason: string,
): GateRecord {
  return {
    id,
    status: accepted ? "accepted" : "not_qualified",
    stage: "profile_capability",
    subject: "qualified LOCAL runtime",
    anchor: null,
    evidence: accepted ? evidence : [],
    reason,
  };
}

/** Fingerprint equality qualifies identity only; every capability has its own source/probe evidence. */
export async function buildLocalQualification(input: {
  descriptor: LocalDescriptor | null;
  fingerprint: NativeFingerprint;
}): Promise<LocalQualificationResult> {
  const { descriptor: d, fingerprint: f } = input;
  const identity =
    !!d &&
    d.mode === "LOCAL" &&
    d.status === "running" &&
    d.qualified === true &&
    d.genesisHash === f.genesis &&
    d.runtimeCodeHash === f.runtimeCodeHash &&
    d.metadataSha256 === f.metadataSha256 &&
    d.runtime.specName === "account-handoff-local" &&
    f.specName === d.runtime.specName &&
    d.runtime.specVersion === f.specVersion &&
    d.runtime.nativeDecimals === f.tokenDecimals &&
    d.runtime.nativeToEthRatio === "10000" &&
    d.runtime.autoMap === false &&
    f.metadataBinding === "pinned-runtime-code" &&
    !!f.metadataSourceAnchor &&
    !!d.nativeMetadataBinding &&
    d.nativeMetadataBinding.metadataSha256 === f.metadataSha256 &&
    d.nativeMetadataBinding.rawMetadata === f.rawMetadata &&
    d.nativeMetadataBinding.specVersion === f.specVersion &&
    d.nativeMetadataBinding.runtimeCodeHash === f.runtimeCodeHash &&
    d.nativeMetadataBinding.genesis === f.genesis &&
    d.nativeMetadataBinding.sourceAnchor.blockHash ===
      f.metadataSourceAnchor.blockHash &&
    d.nativeMetadataBinding.sourceAnchor.blockNumber ===
      f.metadataSourceAnchor.blockNumber &&
    SHA.test(d.generatedNativeTypesSha256 ?? "") &&
    SHA.test(d.buildHash ?? "") &&
    COMMIT.test(d.sourceCommit ?? "") &&
    (await sha256(hexBytes(f.rawMetadata))) === f.metadataSha256;
  const build: EvidenceRef = {
    kind: "local_artifact",
    locator: d ? `local:${d.runId}:${d.generation}:build` : "unqualified-local",
    sourceId: d?.sourceCommit ?? null,
    contentSha256: d?.buildHash ?? null,
  };
  const result: LocalQualificationResult = {
    status: identity ? "accepted" : "candidate",
    apiBindings: [],
    gateRecords: [
      gate(
        "Q-RUNTIME",
        identity,
        [build],
        identity
          ? "Exact LOCAL build, raw metadata, runtime and generated types match."
          : "LOCAL identity or raw artifacts are not qualified.",
      ),
    ],
    sourceEvidence: [build],
    mappingConfigurationEvidence: [],
    bindingEvidence: {
      rawMetadataEvidence: {
        kind: "native_chain",
        locator: `native:${f.genesis}:${f.metadataSourceAnchor?.blockHash ?? "unbound"}:metadata:${f.metadataSha256}`,
        sourceId: f.metadataSha256,
        contentSha256: f.metadataSha256,
      },
      rawRuntimeCodeEvidence: {
        kind: "native_chain",
        locator: `native:${f.genesis}:code:${f.runtimeCodeHash}`,
        sourceId: f.runtimeCodeHash,
        contentSha256: null,
      },
      runtimeSourceBuildRelationship: identity ? build : null,
      generatedNativeTypesSha256: d?.generatedNativeTypesSha256 ?? null,
      abiSha256: d?.contract?.abiSha256 ?? null,
      contractAddress: d?.contract?.address ?? null,
      contractRuntimeCodeHash: d?.contract?.runtimeCodeHash ?? null,
      contractSourceBuildRelationship: d?.contract ? build : null,
    },
  };
  const manifest = d?.capabilities;
  const bound =
    identity &&
    manifest?.format === "account-handoff-local-capabilities-v1" &&
    manifest.runId === d.runId &&
    manifest.generation === d.generation &&
    manifest.genesisHash === f.genesis &&
    manifest.metadataSha256 === f.metadataSha256 &&
    manifest.runtimeCodeHash === f.runtimeCodeHash &&
    manifest.generatedNativeTypesSha256 === d.generatedNativeTypesSha256;
  const c = bound ? manifest : undefined;
  const commit = d?.sourceCommit ?? "";
  const nativeProbes = (
    items: EvidenceRef[] | undefined,
  ): items is EvidenceRef[] =>
    evidenced(items) &&
    items.every(
      (item) =>
        item.kind === "native_chain" &&
        item.sourceId === `${f.genesis}:${d?.runId}:${d?.generation}`,
    );
  const currency = c?.currency;
  const currencyOk =
    currency?.composition === "shared-balances-with-reason-holds" &&
    currency.nativeToEthRatio === "10000" &&
    currency.nativeDecimals === f.tokenDecimals &&
    sourceBound(currency.evidence, commit);
  result.gateRecords.push(
    gate(
      "Q-CURRENCY",
      currencyOk === true,
      currency?.evidence ?? [],
      "Source-bound shared balance, reserve and hold composition is required.",
    ),
  );
  const mapping = c?.mapping;
  const mappingOk =
    mapping?.algorithm === "keccak256-last20" &&
    mapping.autoMap === false &&
    mapping.originalAccount === "persisted-native-account" &&
    sourceBound(mapping.evidence, commit);
  if (mappingOk) result.mappingConfigurationEvidence = mapping!.evidence;
  result.gateRecords.push(
    gate(
      "Q-MAPPING",
      mappingOk === true,
      mapping?.evidence ?? [],
      "Explicit normal-account mapping source configuration is required; account mapping itself is checked per action.",
    ),
  );
  const vesting = c?.vesting;
  const vestingOk =
    vesting?.clock === "native-block-number" &&
    vesting.precompile === "0x0000000000000000000000000000000009020000" &&
    sourceBound(vesting.sourceEvidence, commit) &&
    nativeProbes(vesting.nativeReleaseEvidence);
  result.gateRecords.push(
    gate(
      "Q-VESTING",
      vestingOk === true,
      [
        ...(vesting?.sourceEvidence ?? []),
        ...(vesting?.nativeReleaseEvidence ?? []),
      ],
      "The configured vesting clock/precompile and actual native release probe are required.",
    ),
  );
  const adapter = c?.adapter;
  const adapterOk =
    adapter?.dedot === "1.4.0" &&
    adapter.viem === "2.40.3" &&
    adapter.transport === "legacy" &&
    SHA.test(adapter.packageLockSha256) &&
    evidenced(adapter.packageEvidence) &&
    nativeProbes(adapter.verificationEvidence);
  if (adapterOk) {
    result.bindingEvidence.packageLockSha256 = adapter!.packageLockSha256;
    result.bindingEvidence.packageArtifactEvidence = adapter!.packageEvidence;
  }
  result.gateRecords.push(
    gate(
      "Q-ADAPTER",
      adapterOk === true,
      [
        ...(adapter?.packageEvidence ?? []),
        ...(adapter?.verificationEvidence ?? []),
      ],
      "Pinned package artifacts and executed adapter checks must be retained.",
    ),
  );
  const receipts = c?.receipts;
  const receiptsOk =
    receipts?.correlation ===
      "finalized-block-extrinsic-index-and-whole-byte-hash" &&
    receipts.nestedFailures === "proxy-and-multisig-inspected" &&
    nativeProbes(receipts.successEvidence) &&
    nativeProbes(receipts.failureEvidence);
  result.gateRecords.push(
    gate(
      "Q-RECEIPTS",
      receiptsOk === true,
      [
        ...(receipts?.successEvidence ?? []),
        ...(receipts?.failureEvidence ?? []),
      ],
      "Executed success and nested-failure probes must establish exact finalized native correlation.",
    ),
  );
  const contractOk =
    identity &&
    !!d?.contract &&
    SHA.test(d.contract.sourceSha256) &&
    SHA.test(d.contract.abiSha256) &&
    /^0x[0-9a-f]{64}$/.test(d.contract.runtimeCodeHash);
  result.gateRecords.push(
    gate(
      "Q-CONTRACT",
      contractOk,
      contractOk
        ? [
            build,
            {
              kind: "local_artifact",
              locator: `local:${d!.runId}:${d!.generation}:Vestry:${d!.contract!.address}`,
              sourceId: d!.contract!.sourceSha256,
              contentSha256: d!.contract!.abiSha256,
            },
          ]
        : [],
      "Unchanged Vestry source, ABI and verified deployment are required.",
    ),
  );
  const apiSource = c?.apiSource;
  if (
    identity &&
    apiSource &&
    sourceBound(apiSource.trait, commit) &&
    sourceBound(apiSource.implementation, commit)
  ) {
    const metadata = $Metadata.tryDecode(f.rawMetadata).metadataVersioned;
    const api =
      metadata.type === "V15" || metadata.type === "V16"
        ? metadata.value.apis.find((entry) => entry.name === "ReviveApi")
        : undefined;
    const id = blake2AsHex(new TextEncoder().encode("ReviveApi"), 64);
    if (
      api &&
      api.methods.some((method) => method.name === "call") &&
      f.runtimeApis[id] === 2 &&
      (f.metadataVersion !== 16 || ("version" in api && api.version === 2))
    ) {
      const methods = api.methods.map((method) => ({
        methodName: method.name,
        rpcMethodName: `ReviveApi_${method.name}`,
        canonicalSignature: `ReviveApi.${method.name}(${method.inputs.map((arg) => `${arg.name}:scaleType(${arg.typeId})`).join(",")})->scaleType(${method.output})@${f.metadataSha256}`,
        inputCodecArtifactSha256: d!.generatedNativeTypesSha256!,
        outputCodecArtifactSha256: d!.generatedNativeTypesSha256!,
        typeRegistrySha256: f.metadataSha256,
        sourceEvidence: apiSource.trait,
      }));
      result.apiBindings.push({
        name: "ReviveApi",
        version: "2",
        status: "qualified",
        codecArtifactSha256: d!.generatedNativeTypesSha256!,
        sourceEvidence: [build, ...apiSource.trait],
        boundRuntimeCodeHash: f.runtimeCodeHash,
        boundMetadataSha256: f.metadataSha256,
        methodManifestSha256: await sha256(canonicalJson(methods)),
        traitSourceEvidence: apiSource.trait,
        runtimeImplementationEvidence: apiSource.implementation,
        methods,
      });
    }
  }
  result.gateRecords.push(
    gate(
      "Q-REVIVE-API",
      result.apiBindings.length === 1,
      result.apiBindings[0]?.sourceEvidence ?? [],
      "Version 2 advertisement, exact metadata method/type IDs, source trait and runtime implementation must all bind.",
    ),
  );
  return result;
}
