import { afterEach, describe, expect, it, vi } from "vitest";
import { DedotClient } from "dedot";
import { $Metadata, $OpaqueMetadata, Metadata } from "dedot/codecs";
import { Option } from "dedot/shape";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import { NativeConnection } from "@account-handoff/native-adapter";
import type { NativeTx } from "@account-handoff/native-adapter";
import type { NativeMetadataBinding } from "@account-handoff/native-adapter";
import { sha256 } from "@account-handoff/contracts";

const sourceHash = `0x${"11".repeat(32)}` as const;
const currentHash = `0x${"22".repeat(32)}` as const;
const genesis = `0x${"33".repeat(32)}` as const;
const code = "0x01" as const;
function metadata(label: string): Metadata {
  return new Metadata(0x6174656d, {
    type: "V16",
    value: {
      types: [
        {
          id: 0,
          path: [label],
          params: [],
          typeDef: { type: "Primitive", value: { kind: "u8" } },
          docs: [],
        },
      ],
      pallets: [],
      extrinsic: {
        versions: [4],
        addressTypeId: 0,
        callTypeId: 0,
        signatureTypeId: 0,
        signedExtensionsByVersion: new Map([[0, []]]),
        signedExtensions: [],
      },
      apis: [],
      outerEnums: { callEnumTypeId: 0, eventEnumTypeId: 0, errorEnumTypeId: 0 },
      custom: { map: new Map() },
    },
  });
}
function fixture() {
  const source = metadata("source"),
    current = metadata("current");
  const raw = u8aToHex($Metadata.tryEncode(source)),
    currentRaw = u8aToHex($Metadata.tryEncode(current));
  const response = (bytes: `0x${string}`) =>
    u8aToHex(Option($OpaqueMetadata).tryEncode(bytes));
  const api = {
    metadata: source,
    genesisHash: genesis,
    runtimeVersion: { specVersion: 1, transactionVersion: 1 },
    registry: { metadata: { extrinsic: { signedExtensions: [] } } },
    at: vi.fn(async () => ({ metadata: source })),
    disconnect: vi.fn().mockResolvedValue(undefined),
    rpc: {
      chain_getFinalizedHead: vi.fn().mockResolvedValue(currentHash),
      chain_getHeader: vi.fn(async (hash: string) => ({
        number: hash === sourceHash ? 1 : 10,
        parentHash: genesis,
      })),
      chain_getBlockHash: vi.fn(async (height: number) =>
        height === 1 ? sourceHash : currentHash,
      ),
      state_getStorage: vi.fn().mockResolvedValue(code),
      state_getStorageHash: vi.fn().mockResolvedValue(blake2AsHex(code)),
      state_getRuntimeVersion: vi.fn().mockResolvedValue({
        specName: "synthetic",
        specVersion: 1,
        transactionVersion: 1,
        apis: [],
      }),
      system_properties: vi.fn().mockResolvedValue({
        tokenDecimals: 14,
        tokenSymbol: "UNIT",
        ss58Format: 42,
      }),
      state_call: vi.fn(async (_method: string, _input: string, hash: string) =>
        response(hash === sourceHash ? raw : currentRaw),
      ),
    },
  };
  return { api, raw, currentRaw };
}
afterEach(() => vi.restoreAllMocks());

describe("exact immutable metadata and explicit decoder binding", () => {
  it("keeps discovery-only clients out of signing and sending", async () => {
    const connection = Object.create(
      NativeConnection.prototype,
    ) as NativeConnection;
    await expect(
      connection.prepareSigning({} as NativeTx, genesis),
    ).rejects.toThrow("verified metadata binding");
    await expect(connection.send("0x00")).rejects.toThrow(
      "verified metadata binding",
    );
  });
  it("captures raw V16 from the requested finalized hash without reading the cached decoder", async () => {
    const { api, raw } = fixture();
    Object.defineProperty(api, "metadata", {
      get() {
        throw new Error("cached metadata must not be consulted");
      },
    });
    const connection = Object.create(
      NativeConnection.prototype,
    ) as NativeConnection;
    Object.defineProperty(connection, "api", { value: api });
    const result = await connection.captureMetadata(sourceHash);
    expect(api.rpc.state_call).toHaveBeenCalledExactlyOnceWith(
      "Metadata_metadata_at_version",
      "0x10000000",
      sourceHash,
    );
    expect(result).toMatchObject({
      rawMetadata: raw,
      metadataSha256: await sha256($Metadata.tryEncode(metadata("source"))),
      metadataVersion: 16,
      blockHash: sourceHash,
      blockNumber: 1,
      genesis,
      finalized: true,
      runtimeCodeHash: blake2AsHex(code),
    });
  });
  it("injects the exact verified blob and keeps raw current capture distinct from decoder identity", async () => {
    const { api, raw, currentRaw } = fixture();
    const create = vi
      .spyOn(DedotClient, "legacy")
      .mockResolvedValue(
        api as unknown as Awaited<ReturnType<typeof DedotClient.legacy>>,
      );
    const binding: NativeMetadataBinding = {
      genesis,
      specVersion: 1,
      runtimeCodeHash: blake2AsHex(code),
      metadataSha256: await sha256($Metadata.tryEncode(metadata("source"))),
      rawMetadata: raw,
      sourceAnchor: { blockHash: sourceHash, blockNumber: 1 },
    };
    const connection = await NativeConnection.connect(
      "ws://127.0.0.1:9944",
      "LOCAL",
      binding,
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      cacheMetadata: false,
      metadata: { [`RAW_META/${genesis}/1`]: raw },
    });
    const current = await connection.captureMetadata(currentHash);
    expect(current.rawMetadata).toBe(currentRaw);
    const fingerprint = await connection.fingerprint(currentHash);
    expect(fingerprint).toMatchObject({
      metadataBinding: "pinned-runtime-code",
      metadataSourceAnchor: binding.sourceAnchor,
      metadataSha256: binding.metadataSha256,
      rawMetadata: raw,
    });
    expect(fingerprint.metadataSha256).not.toBe(current.metadataSha256);
  });
  it("refuses a falsely labelled source and closes the client without fallback", async () => {
    const { api, raw } = fixture();
    vi.spyOn(DedotClient, "legacy").mockResolvedValue(
      api as unknown as Awaited<ReturnType<typeof DedotClient.legacy>>,
    );
    const binding: NativeMetadataBinding = {
      genesis,
      specVersion: 1,
      runtimeCodeHash: blake2AsHex(code),
      metadataSha256: await sha256($Metadata.tryEncode(metadata("source"))),
      rawMetadata: raw,
      sourceAnchor: { blockHash: currentHash, blockNumber: 10 },
    };
    await expect(
      NativeConnection.connect("ws://127.0.0.1:9944", "LOCAL", binding),
    ).rejects.toThrow(/immutable native source/);
    expect(api.disconnect).toHaveBeenCalledOnce();
  });
  it("refuses typed reads after code changes even if the spec number is unchanged", async () => {
    const { api, raw } = fixture();
    vi.spyOn(DedotClient, "legacy").mockResolvedValue(
      api as unknown as Awaited<ReturnType<typeof DedotClient.legacy>>,
    );
    const binding: NativeMetadataBinding = {
      genesis,
      specVersion: 1,
      runtimeCodeHash: blake2AsHex(code),
      metadataSha256: await sha256($Metadata.tryEncode(metadata("source"))),
      rawMetadata: raw,
      sourceAnchor: { blockHash: sourceHash, blockNumber: 1 },
    };
    const connection = await NativeConnection.connect(
      "ws://127.0.0.1:9944",
      "LOCAL",
      binding,
    );
    api.at.mockClear();
    api.rpc.state_getStorageHash.mockResolvedValue(blake2AsHex("0x02"));
    await expect(connection.readAccount(genesis, currentHash)).rejects.toThrow(
      /immutable metadata binding/,
    );
    expect(api.at).not.toHaveBeenCalled();
  });
});
