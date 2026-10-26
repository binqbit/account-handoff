import { account, hex, number, plain } from "@account-handoff/native-adapter";
import type { Hex, NativeConnection } from "@account-handoff/native-adapter";
import type { FinalizedHistorySource, HistoryBlock } from "./history.js";

// Bound memory to the same maximum range admitted by the history scanner.
const BLOCK_LIMIT = 4096;
const caches = new WeakMap<NativeConnection, Map<Hex, Promise<HistoryBlock>>>();

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected structured chain evidence");
  return value as Record<string, unknown>;
}

export function nativeHistorySource(
  connection: NativeConnection,
  range?: { fromBlock: number; toBlock: number },
): FinalizedHistorySource {
  if (
    range &&
    (!Number.isSafeInteger(range.fromBlock) ||
      !Number.isSafeInteger(range.toBlock) ||
      range.fromBlock < 0 ||
      range.toBlock < range.fromBlock ||
      range.toBlock - range.fromBlock + 1 > BLOCK_LIMIT)
  )
    throw new Error("Invalid canonical history range");
  let rangeHashes: Promise<Map<number, Hex> | null> | undefined;
  async function canonicalRange(): Promise<Map<number, Hex> | null> {
    if (!range) return null;
    const heights = Array.from(
      { length: range.toBlock - range.fromBlock + 1 },
      (_, i) => range.fromBlock + i,
    );
    let response: unknown;
    try {
      // Substrate's chain_getBlockHash accepts ListOrValue<NumberOrHex>.
      response = await connection.api.provider.send("chain_getBlockHash", [
        heights,
      ]);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === -32602
      )
        return null;
      throw error;
    }
    // Some local RPC replicas implement only the scalar form. Keep its exact checks.
    if (typeof response === "string") return null;
    if (!Array.isArray(response) || response.length !== heights.length)
      throw new Error("Canonical block hash list has the wrong length");
    return new Map(
      heights.map((height, index) => [height, hex(response[index], 32)]),
    );
  }
  let cache = caches.get(connection);
  if (!cache) {
    cache = new Map();
    caches.set(connection, cache);
  }
  const source: FinalizedHistorySource = {
    async finalizedHeight() {
      return number(
        (await connection.api.rpc.chain_getHeader(
          await connection.api.rpc.chain_getFinalizedHead(),
        ))!.number,
      );
    },
    async block(height) {
      const hashes =
        range && height >= range.fromBlock && height <= range.toBlock
          ? await (rangeHashes ??= canonicalRange())
          : null;
      const blockHash =
        hashes?.get(height) ??
        (await connection.api.rpc.chain_getBlockHash(height));
      if (!blockHash) throw new Error("Historical block hash is unavailable");
      // Re-resolve the canonical hash even on a hit, including after a LOCAL reset.
      const key = hex(blockHash, 32);
      let pending = cache!.get(key);
      if (!pending) {
        pending = loadBlock(height, key);
        cache!.set(key, pending);
        if (cache!.size > BLOCK_LIMIT)
          cache!.delete(cache!.keys().next().value!);
        pending.catch(() => {
          if (cache!.get(key) === pending) cache!.delete(key);
        });
      }
      // Callers may retain or annotate entries; never expose cached mutable evidence.
      return structuredClone(await pending);
    },
    async verifyCanonicalRange() {
      if (!range || !rangeHashes) return;
      const hashes = await rangeHashes;
      if (!hashes) return;
      const current = await connection.api.rpc.chain_getBlockHash(
        range.toBlock,
      );
      if (current !== hashes.get(range.toBlock))
        throw new Error("Canonical history changed during the scan");
    },
  };
  async function loadBlock(
    height: number,
    blockHash: Hex,
  ): Promise<HistoryBlock> {
    const signedBlock = await connection.api.rpc.chain_getBlock(blockHash);
    if (!signedBlock) throw new Error("Historical block is unavailable");
    await connection.assertRuntimeAt(hex(blockHash, 32));
    const at = await connection.api.at(blockHash);
    const [events, currentCodeHash, parentCodeHash] = await Promise.all([
      at.query.system.events(),
      connection.api.rpc.state_getStorageHash("0x3a636f6465", blockHash),
      height === 0
        ? Promise.resolve(null)
        : connection.api.rpc.state_getStorageHash(
            "0x3a636f6465",
            signedBlock.block.header.parentHash,
          ),
    ]);
    const executionCompatible =
      currentCodeHash !== null &&
      (height === 0 || currentCodeHash === parentCodeHash);
    return {
      number: number(signedBlock.block.header.number),
      hash: hex(blockHash, 32),
      executionCompatible,
      events: events.map((entry, eventIndex) => {
        const rawEvent = entry.event;
        return {
          pallet: rawEvent.pallet,
          name:
            typeof rawEvent.palletEvent === "string"
              ? rawEvent.palletEvent
              : rawEvent.palletEvent.name,
          data:
            typeof rawEvent.palletEvent === "string" ||
            !("data" in rawEvent.palletEvent)
              ? {}
              : object(plain(rawEvent.palletEvent.data)),
          eventIndex,
          txIndex:
            entry.phase.type === "ApplyExtrinsic" ? entry.phase.value : null,
        };
      }),
      extrinsics: signedBlock.block.extrinsics.map((bytes) => {
        const extrinsic = at.registry.$Extrinsic.tryDecode(bytes);
        let signer: string | null = null;
        if (extrinsic.signature) {
          const address = object(plain(extrinsic.signature.address));
          if (address.type === "Id" && typeof address.value === "string")
            signer = account(address.value);
        }
        return { bytes: hex(bytes), call: plain(extrinsic.call), signer };
      }),
    };
  }
  return source;
}
