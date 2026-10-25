import type { DedotClient } from "dedot";
import { $Metadata, $OpaqueMetadata } from "dedot/codecs";
import { Option, u32 } from "dedot/shape";
import { blake2AsHex, hexToU8a, u8aToHex } from "dedot/utils";
import { sha256 } from "@account-handoff/contracts";
import type { NativeConnection } from "./connection";
import type {
  Hex,
  NativeFingerprint,
  NativeMetadataBinding,
  NativeMetadataCapture,
} from "./types";
import { hex, number } from "./values";

export async function validateMetadataBinding(
  binding: NativeMetadataBinding,
): Promise<NativeMetadataBinding> {
  if (
    !Number.isSafeInteger(binding.specVersion) ||
    binding.specVersion < 0 ||
    !Number.isSafeInteger(binding.sourceAnchor.blockNumber) ||
    binding.sourceAnchor.blockNumber < 0 ||
    binding.rawMetadata.length > 2 * 2_097_152 + 2 ||
    !/^[0-9a-f]{64}$/.test(binding.metadataSha256)
  )
    throw new Error("Invalid bounded native metadata binding");
  const pinned: NativeMetadataBinding = {
    ...binding,
    genesis: hex(binding.genesis, 32),
    runtimeCodeHash: hex(binding.runtimeCodeHash, 32),
    rawMetadata: hex(binding.rawMetadata),
    sourceAnchor: {
      blockHash: hex(binding.sourceAnchor.blockHash, 32),
      blockNumber: binding.sourceAnchor.blockNumber,
    },
  };
  const decoded = $Metadata.tryDecode(pinned.rawMetadata);
  if (
    ![14, 15, 16].includes(decoded.versionNumber) ||
    (await sha256(hexToU8a(pinned.rawMetadata))) !== pinned.metadataSha256 ||
    u8aToHex($Metadata.tryEncode(decoded)) !== pinned.rawMetadata
  )
    throw new Error(
      "Pinned metadata bytes do not match their exact hash and format",
    );
  return pinned;
}

export async function assertRuntimeAt(
  api: DedotClient,
  binding: NativeMetadataBinding | undefined,
  blockHash: Hex,
): Promise<void> {
  if (!binding) return;
  const [codeHash, version] = await Promise.all([
    api.rpc.state_getStorageHash("0x3a636f6465", blockHash),
    api.rpc.state_getRuntimeVersion(blockHash),
  ]);
  if (
    api.genesisHash !== binding.genesis ||
    codeHash !== binding.runtimeCodeHash ||
    version.specVersion !== binding.specVersion
  )
    throw new Error(
      "Native runtime differs from the immutable metadata binding",
    );
}

export async function readFingerprint(
  connection: NativeConnection,
  binding: NativeMetadataBinding | undefined,
  atHash?: Hex,
): Promise<NativeFingerprint> {
  const hash =
    atHash ?? hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  const [header, code, version, properties] = await Promise.all([
    connection.api.rpc.chain_getHeader(hash),
    binding
      ? connection.api.rpc.state_getStorageHash("0x3a636f6465", hash)
      : connection.api.rpc.state_getStorage("0x3a636f6465", hash),
    connection.api.rpc.state_getRuntimeVersion(hash),
    connection.api.rpc.system_properties(),
  ]);
  if (!header || !code)
    throw new Error("Finalized runtime identity is unavailable");
  const runtimeCodeHash = binding ? hex(code, 32) : blake2AsHex(code);
  if (
    binding &&
    (connection.api.genesisHash !== binding.genesis ||
      runtimeCodeHash !== binding.runtimeCodeHash ||
      version.specVersion !== binding.specVersion)
  )
    throw new Error(
      "Native runtime differs from the immutable metadata binding",
    );
  if (
    version.specVersion !== connection.api.runtimeVersion.specVersion ||
    version.transactionVersion !==
      connection.api.runtimeVersion.transactionVersion
  )
    throw new Error(
      "Runtime changed at the finalized boundary; refresh its exact metadata before preparing operations",
    );
  if (header.number > 0) {
    if (binding) await connection.assertRuntimeAt(hex(header.parentHash, 32));
    const before = await connection.api.rpc.state_getRuntimeVersion(
      header.parentHash,
    );
    if (
      before.specVersion !== version.specVersion ||
      before.transactionVersion !== version.transactionVersion
    )
      throw new Error(
        "Runtime upgrade boundary requires an independently qualified historical decoder",
      );
  }
  const metadataObject = atHash
    ? (await connection.api.at(hash)).metadata
    : connection.api.metadata;
  const metadata = u8aToHex($Metadata.tryEncode(metadataObject));
  const metadataSha256 = await sha256(hexToU8a(hex(metadata)));
  if (
    binding &&
    (metadataSha256 !== binding.metadataSha256 ||
      metadata !== binding.rawMetadata)
  )
    throw new Error(
      "The active native registry does not use the exact pinned metadata",
    );
  const symbol = properties.tokenSymbol;
  const decimals = properties.tokenDecimals;
  return {
    genesis: hex(connection.api.genesisHash, 32),
    specName: version.specName,
    specVersion: version.specVersion,
    transactionVersion: version.transactionVersion,
    metadataVersion: metadataObject.versionNumber,
    metadataHash: blake2AsHex(hex(metadata)),
    metadataSha256,
    rawMetadata: hex(metadata),
    runtimeCodeHash,
    signedExtensions:
      connection.api.registry.metadata.extrinsic.signedExtensions.map(
        (e) => e.ident,
      ),
    runtimeApis: Object.fromEntries(version.apis),
    anchor: { hash, number: number(header.number) },
    tokenDecimals:
      typeof decimals === "number"
        ? decimals
        : Array.isArray(decimals)
          ? number(decimals[0])
          : 0,
    tokenSymbol:
      typeof symbol === "string"
        ? symbol
        : Array.isArray(symbol)
          ? String(symbol[0])
          : "UNIT",
    ss58Prefix: number(properties.ss58Format ?? 42),
    metadataBinding: binding ? "pinned-runtime-code" : "unbound-client-cache",
    ...(binding ? { metadataSourceAnchor: { ...binding.sourceAnchor } } : {}),
  };
}
/** Captures exact RPC bytes at one finalized hash, independently of the client's cached registry. */

export async function captureMetadata(
  api: DedotClient,
  blockHash: Hex,
  metadataVersion: 14 | 15 | 16 = 16,
): Promise<NativeMetadataCapture> {
  const sourceHash = hex(blockHash, 32);
  const [header, code, version, finalizedHash, response] = await Promise.all([
    api.rpc.chain_getHeader(sourceHash),
    api.rpc.state_getStorage("0x3a636f6465", sourceHash),
    api.rpc.state_getRuntimeVersion(sourceHash),
    api.rpc.chain_getFinalizedHead(),
    api.rpc.state_call(
      "Metadata_metadata_at_version",
      u8aToHex(u32.tryEncode(metadataVersion)),
      sourceHash,
    ),
  ]);
  if (!header || !code)
    throw new Error("Metadata source block or runtime code is unavailable");
  const [finalizedHeader, canonicalHash] = await Promise.all([
    api.rpc.chain_getHeader(finalizedHash),
    api.rpc.chain_getBlockHash(header.number),
  ]);
  if (
    !finalizedHeader ||
    header.number > finalizedHeader.number ||
    canonicalHash !== sourceHash
  )
    throw new Error("Metadata source is not a canonical finalized block");
  const codec = Option($OpaqueMetadata);
  const raw = codec.tryDecode(response);
  if (u8aToHex(codec.tryEncode(raw)) !== hex(response))
    throw new Error("Metadata API returned a noncanonical SCALE envelope");
  if (!raw)
    throw new Error(
      `Metadata version ${metadataVersion} is unavailable at the source block`,
    );
  const exact = hex(raw);
  const decoded = $Metadata.tryDecode(exact);
  if (
    decoded.versionNumber !== metadataVersion ||
    u8aToHex($Metadata.tryEncode(decoded)) !== exact
  )
    throw new Error(
      "Metadata API returned different or noncanonical metadata bytes",
    );
  return {
    genesis: hex(api.genesisHash, 32),
    blockHash: sourceHash,
    blockNumber: number(header.number),
    finalized: true,
    runtimeCodeHash: blake2AsHex(code),
    specName: version.specName,
    specVersion: version.specVersion,
    transactionVersion: version.transactionVersion,
    metadataVersion,
    metadataSha256: await sha256(hexToU8a(exact)),
    metadataHash: blake2AsHex(exact),
    rawMetadata: exact,
  };
}
