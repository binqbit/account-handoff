import { describe, expect, it, vi } from "vitest";
import type { NativeConnection } from "@account-handoff/native-adapter";
import { nativeHistorySource } from "../../../packages/grant-adapter/src/history-source";

const hash = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
function fixture() {
  const rpc = {
    chain_getBlockHash: vi.fn(async (height: number) => hash(height)),
    chain_getBlock: vi.fn(async () => ({
      block: { header: { number: 1, parentHash: hash(0) }, extrinsics: [] },
    })),
    state_getStorageHash: vi.fn(async () => hash(100)),
  };
  const events = vi.fn(async () => [
    {
      event: { pallet: "System", palletEvent: "ExtrinsicSuccess" },
      phase: { type: "ApplyExtrinsic", value: 0 },
    },
  ]);
  const connection = {
    api: { rpc, at: vi.fn(async () => ({ query: { system: { events } } })) },
    assertRuntimeAt: vi.fn(async () => {}),
  } as unknown as NativeConnection;
  return { connection, rpc, events };
}

describe("native history block reuse", () => {
  it("rechecks canonical hashes while reusing decoded evidence across scans", async () => {
    const { connection, rpc, events } = fixture();
    const first = await nativeHistorySource(connection).block(1);
    first.events[0]!.name = "caller mutation";
    const next = await nativeHistorySource(connection).block(1);
    expect(next.events[0]!.name).toBe("ExtrinsicSuccess");
    expect(rpc.chain_getBlockHash).toHaveBeenCalledTimes(2);
    expect(rpc.chain_getBlock).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it("reloads changed canonical blocks and keeps connections isolated", async () => {
    const first = fixture();
    await nativeHistorySource(first.connection).block(1);
    first.rpc.chain_getBlockHash.mockResolvedValue(hash(2));
    expect((await nativeHistorySource(first.connection).block(1)).hash).toBe(
      hash(2),
    );
    expect(first.rpc.chain_getBlock).toHaveBeenCalledTimes(2);
    const other = fixture();
    await nativeHistorySource(other.connection).block(1);
    expect(other.rpc.chain_getBlock).toHaveBeenCalledTimes(1);
  });

  it("shares concurrent reads and retries failed reads without cached failures", async () => {
    const { connection, rpc } = fixture();
    rpc.chain_getBlock.mockRejectedValueOnce(new Error("unavailable"));
    await expect(nativeHistorySource(connection).block(1)).rejects.toThrow(
      "unavailable",
    );
    const [first, second] = await Promise.all([
      nativeHistorySource(connection).block(1),
      nativeHistorySource(connection).block(1),
    ]);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(rpc.chain_getBlock).toHaveBeenCalledTimes(2);
  });

  it("evicts evidence outside its bounded working set", async () => {
    const { connection, rpc } = fixture();
    const source = nativeHistorySource(connection);
    for (let height = 1; height <= 4097; height++) await source.block(height);
    await source.block(1);
    expect(rpc.chain_getBlock).toHaveBeenCalledTimes(4098);
  });
});
