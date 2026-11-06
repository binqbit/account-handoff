import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";
import {
  nativeHistorySource,
  scanGrantHistoryWithSource,
  vestryAbi,
  type FinalizedHistorySource,
  type HistoryBlock,
  type HistoryEvent,
} from "@account-handoff/grant-adapter";
import type {
  Hex,
  NativeConnection,
  NativeFingerprint,
} from "@account-handoff/native-adapter";
import { readGrantHistory } from "../../../apps/web/src/application/grant-history";
import { readWorkspaceState } from "../../../apps/web/src/application/network-state";
import type { WorkspaceRecord } from "../../../apps/web/src/application/models";

vi.mock("@account-handoff/grant-adapter", async (original) => ({
  ...(await original<typeof import("@account-handoff/grant-adapter")>()),
  nativeHistorySource: vi.fn(),
}));

const contract = `0x${"11".repeat(20)}` as Hex;
const actor = `0x${"22".repeat(20)}` as Hex;
const signer = `0x${"22".repeat(32)}` as Hex;
const hash = (height: number, generation = 0): Hex =>
  `0x${(BigInt(generation) * 1_000_000n + BigInt(height)).toString(16).padStart(64, "0")}`;

function emitted(
  name: "GrantCreated" | "MilestoneSubmitted" | "ChangesRequested",
  eventIndex = 0,
): HistoryEvent {
  const topics = encodeEventTopics({
    abi: vestryAbi,
    eventName: name,
    args:
      name === "GrantCreated"
        ? { grantId: 0n, funder: actor, grantee: contract }
        : name === "ChangesRequested"
          ? { grantId: 0n, index: 1n, reviewer: actor }
          : { grantId: 0n, index: 1n },
  });
  return {
    pallet: "Revive",
    name: "ContractEmitted",
    data: {
      contract,
      topics,
      data:
        name === "GrantCreated"
          ? encodeAbiParameters(
              parseAbiParameters("address,uint256,address[],uint8"),
              [contract, 300000n, [actor, contract], 2],
            )
          : encodeAbiParameters(parseAbiParameters("string"), ["evidence"]),
    },
    eventIndex,
    txIndex: 0,
  };
}

type Range = { fromBlock: number; toBlock: number };
const factories = new Map<
  NativeConnection,
  (range: Range | undefined) => FinalizedHistorySource
>();

beforeEach(() => {
  factories.clear();
  vi.mocked(nativeHistorySource).mockImplementation((connection, range) =>
    factories.get(connection)!(range),
  );
});

function fixture(
  events: Record<number, HistoryEvent[]> = { 1: [emitted("GrantCreated")] },
) {
  const state = {
    generation: 0,
    failedHeight: null as number | null,
    incompatibleHeight: null as number | null,
    failedPageEnd: null as number | null,
    events,
  };
  const blockHash = (height: number) => hash(height, state.generation);
  const canonical = vi.fn(async (height: number) => blockHash(height));
  const assertRuntimeAt = vi.fn(async (_hash: Hex) => {});
  const block = vi.fn(async (height: number): Promise<HistoryBlock> => {
    if (height === state.failedHeight)
      throw new Error("Historical block unavailable");
    return {
      number: height,
      hash: blockHash(height),
      executionCompatible: height !== state.incompatibleHeight,
      events: state.events[height] ?? [],
      extrinsics: [{ bytes: "0x0100", call: { pallet: "Multisig" }, signer }],
    };
  });
  const connection = {
    api: { rpc: { chain_getBlockHash: canonical } },
    assertRuntimeAt,
    readAccount: vi.fn(async (address: string) => ({ address })),
  } as unknown as NativeConnection;
  const ranges: Range[] = [];
  const factory = (range?: Range): FinalizedHistorySource => {
    if (range) ranges.push(range);
    return {
      finalizedHeight: async () => 1_000_000,
      block,
      async verifyCanonicalRange() {
        if (range?.toBlock === state.failedPageEnd)
          throw new Error("Canonical history changed during the scan");
      },
    };
  };
  factories.set(connection, factory);
  const fingerprint = (
    height: number,
    runtime = hash(900),
  ): NativeFingerprint =>
    ({
      genesis: hash(0),
      runtimeCodeHash: runtime,
      metadataSha256: "a".repeat(64),
      specName: "fixture",
      specVersion: 1,
      transactionVersion: 1,
      anchor: { hash: blockHash(height), number: height },
    }) as NativeFingerprint;
  const read = (
    height: number,
    extra: Partial<Parameters<typeof readGrantHistory>[2]> = {},
  ) =>
    readGrantHistory(connection, fingerprint(height), {
      contract,
      grantId: "0",
      fromBlock: 1,
      toBlock: height,
      ...extra,
    });
  return {
    state,
    canonical,
    assertRuntimeAt,
    block,
    connection,
    ranges,
    factory,
    fingerprint,
    read,
  };
}

describe("verified incremental grant history", () => {
  it("keeps the production workspace refresh usable beyond the former lifetime limit", async () => {
    const f = fixture();
    const workspace = {
      participants: {},
      M0: { account: signer },
      pure: null,
      contract,
      grantId: "0",
      creationBlock: 1,
      baseline: null,
    } as unknown as WorkspaceRecord;
    const observed = await readWorkspaceState(
      f.connection,
      f.fingerprint(4100),
      workspace,
      [],
    );
    expect(observed.history?.complete).toBe(true);
    expect(observed.history?.scannedThrough).toBe(4100);
    expect(observed.history?.scope).toBe("EligibleSingleRound");
    expect(f.ranges).toHaveLength(2);
  });

  it("reads histories beyond 4096 blocks and preserves events and rounds across every page boundary", async () => {
    const f = fixture({
      1: [emitted("GrantCreated")],
      4096: [emitted("MilestoneSubmitted")],
      4097: [emitted("ChangesRequested")],
      8193: [emitted("MilestoneSubmitted")],
    });
    await expect(
      scanGrantHistoryWithSource(f.factory(), {
        contract,
        grantId: "0",
        fromBlock: 1,
        toBlock: 8200,
      }),
    ).rejects.toThrow(/4096-block/);
    const history = await f.read(8200);
    expect(history.complete).toBe(true);
    expect(history.scope).toBe("ScopeBreached");
    expect(history.rounds).toEqual([0, 1]);
    expect(
      history.entries.map((entry) => [entry.blockNumber, entry.roundBefore]),
    ).toEqual([
      [1, null],
      [4096, 0],
      [4097, 0],
      [8193, 1],
    ]);
    expect(f.ranges).toEqual([
      { fromBlock: 1, toBlock: 4096 },
      { fromBlock: 4097, toBlock: 8192 },
      { fromBlock: 8193, toBlock: 8200 },
    ]);
    expect(f.block.mock.calls.map(([height]) => height)).toEqual(
      Array.from({ length: 8200 }, (_, index) => index + 1),
    );
  });

  it("only appends new blocks and does not expose cached mutable evidence", async () => {
    const f = fixture({
      1: [emitted("GrantCreated")],
      8: [emitted("MilestoneSubmitted")],
    });
    const first = await f.read(6, { pageSize: 4 });
    first.entries[0]!.eventName = "caller mutation";
    const progress: number[] = [];
    const next = await f.read(10, {
      pageSize: 4,
      onProgress: (done) => progress.push(done),
    });
    expect(next.complete).toBe(true);
    expect(next.entries.map((entry) => entry.eventName)).toEqual([
      "GrantCreated",
      "MilestoneSubmitted",
    ]);
    expect(f.block.mock.calls.map(([height]) => height)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(f.canonical).toHaveBeenCalledWith(6);
    expect(progress[0]).toBe(6);
    expect(progress.at(-1)).toBe(10);
    const historical = await f.read(6);
    expect(historical.complete).toBe(true);
    expect(historical.entries).toHaveLength(1);
    expect(historical.scannedThrough).toBe(6);
    expect(f.block).toHaveBeenCalledTimes(10);
  });

  it("retains event-free pages before the grant is created without fabricating a missing creation", async () => {
    const f = fixture({
      4097: [emitted("GrantCreated")],
      4098: [emitted("MilestoneSubmitted")],
    });
    const history = await f.read(4100);
    expect(history.complete).toBe(true);
    expect(history.scope).toBe("EligibleSingleRound");
    expect(history.entries.map((entry) => entry.blockNumber)).toEqual([
      4097, 4098,
    ]);
    expect(history.blockers).toEqual([]);
  });

  it("never advances over a failed page and retries the gap after invalidation", async () => {
    const f = fixture({
      1: [emitted("GrantCreated")],
      4: [emitted("ChangesRequested")],
    });
    f.state.failedHeight = 6;
    const failed = await f.read(10, { pageSize: 4 });
    expect(failed.complete).toBe(false);
    expect(failed.scannedThrough).toBe(4);
    expect(failed.scope).toBe("ScopeBreached");
    expect(failed.entries.map((entry) => entry.blockNumber)).toEqual([1, 4]);
    expect(failed.blockers.join(" ")).toContain("unavailable");
    f.state.failedHeight = null;
    const previousCalls = f.block.mock.calls.length;
    const recovered = await f.read(10, { pageSize: 4 });
    expect(recovered.complete).toBe(true);
    expect(recovered.scope).toBe("ScopeBreached");
    expect(
      f.block.mock.calls.slice(previousCalls).map(([height]) => height),
    ).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
  });

  it("does not commit a fully read page whose canonical verification failed", async () => {
    const f = fixture();
    f.state.failedPageEnd = 8;
    const history = await f.read(8, { pageSize: 4 });
    expect(history.complete).toBe(false);
    expect(history.scannedThrough).toBe(4);
    expect(history.blockers.join(" ")).toMatch(/Canonical history changed/);
    f.state.failedPageEnd = null;
    expect((await f.read(8, { pageSize: 4 })).complete).toBe(true);
    expect(f.block).toHaveBeenCalledTimes(16);
  });

  it("invalidates a same-genesis LOCAL reset on the existing connection", async () => {
    const f = fixture({
      1: [emitted("GrantCreated")],
      3: [emitted("ChangesRequested")],
    });
    expect((await f.read(4)).scope).toBe("ScopeBreached");
    f.state.generation += 1;
    f.state.events = { 1: [emitted("GrantCreated")] };
    const reset = await f.read(4);
    expect(reset.complete).toBe(true);
    expect(reset.scope).toBe("EligibleSingleRound");
    expect(reset.entries).toHaveLength(1);
    expect(reset.entries[0]!.blockHash).toBe(hash(1, 1));
    expect(f.block).toHaveBeenCalledTimes(8);
  });

  it("does not reuse prefixes across runtime bindings or connections", async () => {
    const f = fixture();
    await f.read(4);
    const changed = await readGrantHistory(
      f.connection,
      f.fingerprint(4, hash(901)),
      {
        contract,
        grantId: "0",
        fromBlock: 1,
        toBlock: 4,
      },
    );
    expect(changed.complete).toBe(true);
    expect(f.block).toHaveBeenCalledTimes(8);
    const other = fixture();
    expect((await other.read(4)).complete).toBe(true);
    expect(other.block).toHaveBeenCalledTimes(4);
    f.assertRuntimeAt.mockRejectedValueOnce(
      new Error("Runtime binding changed"),
    );
    expect((await f.read(4)).complete).toBe(false);
  });

  it("does not advance the prefix across a historical runtime upgrade boundary", async () => {
    const f = fixture();
    f.state.incompatibleHeight = 6;
    const history = await f.read(8, { pageSize: 4 });
    expect(history.complete).toBe(false);
    expect(history.scannedThrough).toBe(4);
    expect(history.blockers.join(" ")).toMatch(/runtime context changed/);
  });

  it("rejects a noncanonical target without returning stale successful evidence", async () => {
    const f = fixture();
    await f.read(4);
    f.canonical.mockResolvedValue(hash(999));
    const result = await f.read(4);
    expect(result.complete).toBe(false);
    expect(result.scannedThrough).toBeNull();
    expect(result.entries).toEqual([]);
    expect(result.blockers.join(" ")).toMatch(/canonical chain/);
  });

  it("keeps cancellation incomplete and does not retain prefetched gaps", async () => {
    const f = fixture();
    const controller = new AbortController();
    const canceled = await f.read(8, {
      pageSize: 4,
      signal: controller.signal,
      onProgress(done) {
        if (done === 2) controller.abort();
      },
    });
    expect(canceled.complete).toBe(false);
    expect(canceled.scannedThrough).toBeNull();
    expect(canceled.entries).toEqual([]);
    expect(canceled.blockers).toContain("History scan canceled");
    const beforeRetry = f.block.mock.calls.length;
    expect((await f.read(8)).complete).toBe(true);
    expect(
      f.block.mock.calls.slice(beforeRetry).map(([height]) => height),
    ).toEqual(Array.from({ length: 8 }, (_, index) => index + 1));
  });

  it("enforces the event budget across pages rather than separately per page", async () => {
    const events: Record<number, HistoryEvent[]> = {
      1: [emitted("GrantCreated")],
    };
    for (let height = 2; height <= 10; height++)
      events[height] = Array.from({ length: 1024 }, (_, index) =>
        emitted("ChangesRequested", index),
      );
    const f = fixture(events);
    const history = await f.read(10, { pageSize: 2 });
    expect(history.complete).toBe(false);
    expect(history.blockers.join(" ")).toMatch(/8192-event budget/);
    expect(history.entries.length).toBeLessThanOrEqual(8192);
    expect(history.scope).toBe("ScopeBreached");
  });

  it("serializes concurrent historical/current scans without overwriting a newer cursor", async () => {
    const f = fixture();
    const [older, newer] = await Promise.all([
      f.read(4, { pageSize: 2 }),
      f.read(8, { pageSize: 2 }),
    ]);
    expect(older.scannedThrough).toBe(4);
    expect(newer.scannedThrough).toBe(8);
    expect((await f.read(9)).complete).toBe(true);
    expect(f.block.mock.calls.map(([height]) => height)).toEqual(
      Array.from({ length: 9 }, (_, index) => index + 1),
    );
  });

  it.each([0, 4097, 1.5])(
    "rejects unsupported page size %s without reading",
    async (pageSize) => {
      const f = fixture();
      await expect(f.read(8, { pageSize })).rejects.toThrow(/page size/);
      expect(f.block).not.toHaveBeenCalled();
    },
  );
});
