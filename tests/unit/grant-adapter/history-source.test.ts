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

  it("fetches a fresh canonical list per scan while reusing decoded blocks", async () => {
    const { connection, rpc } = fixture();
    const send = vi.fn(async () => [hash(1), hash(2)]);
    (connection.api as any).provider = { send };
    for (let run = 0; run < 2; run++) {
      const source = nativeHistorySource(connection, {
        fromBlock: 1,
        toBlock: 2,
      });
      await Promise.all([source.block(1), source.block(2)]);
      await source.verifyCanonicalRange!();
    }
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("chain_getBlockHash", [[1, 2]]);
    expect(rpc.chain_getBlockHash).toHaveBeenCalledTimes(2);
    expect(rpc.chain_getBlock).toHaveBeenCalledTimes(2);
  });

  it("rejects a branch change between canonical range lookup and completion", async () => {
    const { connection, rpc } = fixture();
    (connection.api as any).provider = { send: vi.fn(async () => [hash(1)]) };
    const source = nativeHistorySource(connection, {
      fromBlock: 1,
      toBlock: 1,
    });
    await source.block(1);
    rpc.chain_getBlockHash.mockResolvedValue(hash(99));
    await expect(source.verifyCanonicalRange!()).rejects.toThrow(
      "changed during the scan",
    );
  });

  it.each(["scalar", "invalid-params"])(
    "retains individual canonical checks for a %s-only replica",
    async (kind) => {
      const { connection, rpc } = fixture();
      (connection.api as any).provider = {
        send:
          kind === "scalar"
            ? vi.fn(async () => hash(1))
            : vi.fn().mockRejectedValue({ code: -32602 }),
      };
      const source = nativeHistorySource(connection, {
        fromBlock: 1,
        toBlock: 2,
      });
      await source.block(1);
      await source.block(2);
      await source.verifyCanonicalRange!();
      expect(rpc.chain_getBlockHash).toHaveBeenCalledTimes(2);
    },
  );

  it.each([[hash(1)], [hash(1), null]])(
    "fails closed on an incomplete canonical response %j",
    async (...response) => {
      const { connection, rpc } = fixture();
      (connection.api as any).provider = { send: vi.fn(async () => response) };
      await expect(
        nativeHistorySource(connection, { fromBlock: 1, toBlock: 2 }).block(1),
      ).rejects.toThrow();
      expect(rpc.chain_getBlock).not.toHaveBeenCalled();
    },
  );

  it("does not hide network failures as unsupported batch capabilities", async () => {
    const { connection, rpc } = fixture();
    (connection.api as any).provider = {
      send: vi.fn().mockRejectedValue(new Error("offline")),
    };
    await expect(
      nativeHistorySource(connection, { fromBlock: 1, toBlock: 2 }).block(1),
    ).rejects.toThrow("offline");
    expect(rpc.chain_getBlockHash).not.toHaveBeenCalled();
  });
});
