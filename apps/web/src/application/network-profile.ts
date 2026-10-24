import {
  createChainProfile,
  canonicalJson,
  sha256,
} from "@account-handoff/contracts";
import type { ChainProfile } from "@account-handoff/contracts";
import {
  object,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { RuntimeMode } from "../ui-contract";
import type { LocalDescriptor } from "./models";
import { buildLocalQualification } from "./qualification";

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
  d: LocalDescriptor | null,
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
    run: d?.runId ?? null,
    generation: d?.generation ?? null,
    qualified: d?.qualified ?? false,
    buildHash: d?.buildHash ?? null,
    source: d?.sourceCommit ?? null,
    contract: d?.contract ?? null,
    capabilities: d?.capabilities ?? null,
    metadataSourceAnchor: d?.nativeMetadataBinding?.sourceAnchor ?? null,
    metadataBindingDigest,
    generatedNativeTypesSha256: d?.generatedNativeTypesSha256 ?? null,
  });
  const existing = profiles.get(key);
  if (existing) return existing;
  const qualified = await buildLocalQualification({
    descriptor: d,
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
