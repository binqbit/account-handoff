import {
  createChainProfile,
  canonicalJson,
  sha256,
} from "@account-handoff/contracts";
import type { ChainProfile } from "@account-handoff/contracts";
import {
  object,
  type NativeFingerprint,
  type NativeConnection,
} from "@account-handoff/native-adapter";
import type { RuntimeMode } from "../ui-contract";
import type { LocalDescriptor } from "./models";
import { buildLocalQualification } from "./qualification";
import type { NetworkDescriptor } from "./network-descriptor";
import { buildTestnetQualification } from "./qualification/testnet";

export async function readNetworkDescriptor(
  mode: RuntimeMode,
): Promise<NetworkDescriptor | null> {
  if (mode === "DEMO") {
    const { readTestnetDescriptor } = await import("./testnet-descriptor");
    return readTestnetDescriptor();
  }
  return readLocalDescriptor(mode);
}

export async function readLocalDescriptor(
  mode: RuntimeMode,
): Promise<LocalDescriptor | null> {
  if (mode !== "LOCAL") return null;
  const response = await fetch("/local-run.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error("LOCAL manifest is missing. Run local:plan and local:up.");
  const data = object(await response.json());
  if (
    data["mode"] !== "LOCAL" ||
    typeof data["runId"] !== "string" ||
    !Number.isSafeInteger(data["generation"])
  )
    throw new Error("Invalid LOCAL manifest");
  return data as unknown as LocalDescriptor;
}
export async function qualifiedProfile(
  mode: RuntimeMode,
  profiles: Map<string, ChainProfile>,
  f: NativeFingerprint,
  d: NetworkDescriptor | null,
  connection?: NativeConnection,
): Promise<ChainProfile> {
  const metadataBindingDigest = d?.nativeMetadataBinding
    ? await sha256(canonicalJson(d.nativeMetadataBinding))
    : null;
  const key = canonicalJson({
    mode: mode,
    genesis: f.genesis,
    metadata: f.metadataSha256,
    runtimeCode: f.runtimeCodeHash,
    decimals: f.tokenDecimals,
    symbol: f.tokenSymbol,
    ss58Prefix: f.ss58Prefix,
    run: d?.mode === "LOCAL" ? d.runId : null,
    generation: d?.mode === "LOCAL" ? d.generation : null,
    qualified: d?.mode === "LOCAL" ? d.qualified : null,
    buildHash: d?.mode === "LOCAL" ? d.buildHash : null,
    source: d?.mode === "LOCAL" ? d.sourceCommit : null,
    contract: d?.contract ?? null,
    capabilities: d?.mode === "LOCAL" ? d.capabilities : d?.verification,
    metadataSourceAnchor: d?.nativeMetadataBinding?.sourceAnchor ?? null,
    metadataBindingDigest,
    generatedNativeTypesSha256:
      d?.mode === "LOCAL" ? d.generatedNativeTypesSha256 : null,
  });
  const existing = profiles.get(key);
  if (existing) return existing;
  const qualified =
    mode === "DEMO" && d?.mode === "DEMO" && connection
      ? await buildTestnetQualification(d, f, connection)
      : await buildLocalQualification({
          descriptor: d?.mode === "LOCAL" ? d : null,
          fingerprint: f,
        });
  const profileId = `${mode.toLowerCase()}-${await sha256(key)}`;
  const result = await createChainProfile({
    profileId,
    recordId: `profile-${await sha256(key)}`,
    fingerprint: {
      ...f,
      specVersion: String(f.specVersion),
      transactionVersion: String(f.transactionVersion),
      metadataVersion: String(f.metadataVersion),
    },
    ...qualified,
  });
  profiles.set(key, result);
  return result;
}
