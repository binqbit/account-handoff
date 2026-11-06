import {
  nativeHistorySource,
  reduceGrantHistory,
  scanGrantHistoryWithSource,
  type GrantHistory,
  type GrantHistoryEntry,
  type ScanOptions,
} from "@account-handoff/grant-adapter";
import type {
  Hex,
  NativeConnection,
  NativeFingerprint,
} from "@account-handoff/native-adapter";

const PAGE_LIMIT = 4096;
const EVENT_LIMIT = 8192;

interface VerifiedPrefix {
  binding: string;
  through: number;
  hash: Hex;
  entries: GrantHistoryEntry[];
}
interface ConnectionHistory {
  prefix: VerifiedPrefix | null;
  pending: Promise<void>;
}

// Only evidence read during this connection is reusable. Restored local records
// cannot establish an event-free prefix or authorize a grant operation.
const histories = new WeakMap<NativeConnection, ConnectionHistory>();

type HistoryOptions = Omit<ScanOptions, "maxBlocks"> & { pageSize?: number };

/** Scan a lifetime history in bounded pages, then only read its new suffix. */
export async function readGrantHistory(
  connection: NativeConnection,
  fingerprint: NativeFingerprint,
  options: HistoryOptions,
): Promise<GrantHistory> {
  const pageSize = options.pageSize ?? PAGE_LIMIT;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PAGE_LIMIT ||
    !Number.isSafeInteger(options.fromBlock) ||
    !Number.isSafeInteger(options.toBlock) ||
    options.fromBlock < 0 ||
    options.toBlock < options.fromBlock ||
    options.toBlock !== fingerprint.anchor.number
  )
    throw new Error("Invalid anchored history range or page size");

  let session = histories.get(connection);
  if (!session) {
    session = { prefix: null, pending: Promise.resolve() };
    histories.set(connection, session);
  }
  const state = session;
  // Certificate reconstruction and current-state reads may overlap. Serialize
  // their cursor updates so an older scan cannot overwrite a newer prefix.
  const previous = state.pending;
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await scan(connection, fingerprint, options, pageSize, state);
  } finally {
    release();
  }
}

async function scan(
  connection: NativeConnection,
  fingerprint: NativeFingerprint,
  options: HistoryOptions,
  pageSize: number,
  state: ConnectionHistory,
): Promise<GrantHistory> {
  const binding = JSON.stringify([
    fingerprint.genesis,
    fingerprint.runtimeCodeHash,
    fingerprint.metadataSha256,
    fingerprint.specName,
    fingerprint.specVersion,
    fingerprint.transactionVersion,
    options.contract,
    options.grantId,
    options.fromBlock,
  ]);
  if (state.prefix?.binding !== binding) state.prefix = null;
  let prefix = state.prefix;
  const finish = (complete: boolean, blockers: string[] = []): GrantHistory => {
    const entries = structuredClone(
      prefix?.entries.filter((entry) => entry.blockNumber <= options.toBlock) ??
        [],
    );
    const reduced = reduceGrantHistory(entries, complete, blockers);
    return {
      complete: complete && blockers.length === 0,
      fromBlock: options.fromBlock,
      toBlock: options.toBlock,
      scannedThrough: prefix ? Math.min(prefix.through, options.toBlock) : null,
      entries,
      blockers,
      ...reduced,
    };
  };
  const invalidate = (message: string): GrantHistory => {
    state.prefix = null;
    return finish(false, [message]);
  };
  try {
    if (options.signal?.aborted) return invalidate("History scan canceled");
    const targetHash = await connection.api.rpc.chain_getBlockHash(
      options.toBlock,
    );
    if (targetHash !== fingerprint.anchor.hash) {
      prefix = null;
      return invalidate("History target is no longer on the canonical chain");
    }
    await connection.assertRuntimeAt(fingerprint.anchor.hash);
    if (prefix) {
      const current = await connection.api.rpc.chain_getBlockHash(
        prefix.through,
      );
      if (current !== prefix.hash) {
        // LOCAL resets can reuse the same genesis and connection object.
        prefix = null;
        state.prefix = null;
      } else {
        await connection.assertRuntimeAt(prefix.hash);
      }
    }
    const total = options.toBlock - options.fromBlock + 1;
    options.onProgress?.(
      prefix
        ? Math.min(prefix.through, options.toBlock) - options.fromBlock + 1
        : 0,
      total,
    );
    let next = prefix ? prefix.through + 1 : options.fromBlock;
    while (next <= options.toBlock) {
      if (options.signal?.aborted) return invalidate("History scan canceled");
      const end = Math.min(next + pageSize - 1, options.toBlock);
      const source = nativeHistorySource(connection, {
        fromBlock: next,
        toBlock: end,
      });
      let checked = false;
      let endHash: Hex | null = null;
      const page = await scanGrantHistoryWithSource(
        {
          finalizedHeight: () => source.finalizedHeight(),
          async block(height) {
            const block = await source.block(height);
            if (height === end) endHash = block.hash;
            return block;
          },
          async verifyCanonicalRange() {
            await source.verifyCanonicalRange?.();
            checked = true;
          },
        },
        {
          contract: options.contract,
          grantId: options.grantId,
          fromBlock: next,
          toBlock: end,
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (completed) =>
            options.onProgress?.(next - options.fromBlock + completed, total),
        },
      );
      if (options.signal?.aborted) return invalidate("History scan canceled");
      if (!checked || page.scannedThrough !== end || !endHash)
        return invalidate(
          page.blockers.join("; ") || "History page could not be verified",
        );
      const entries = [...(prefix?.entries ?? []), ...page.entries];
      if (entries.length > EVENT_LIMIT)
        return invalidate("Grant history exceeds the 8192-event budget");
      // A later page need not contain GrantCreated. Its reducer's local
      // missing-creation warnings are replaced by the complete-prefix reduction.
      prefix = { binding, through: end, hash: endHash, entries };
      state.prefix = prefix;
      next = end + 1;
    }
    if (
      (await connection.api.rpc.chain_getBlockHash(options.toBlock)) !==
      fingerprint.anchor.hash
    ) {
      prefix = null;
      return invalidate("Canonical history changed during the scan");
    }
    return finish(true);
  } catch (error) {
    return invalidate(
      error instanceof Error ? error.message : "History could not be verified",
    );
  }
}
