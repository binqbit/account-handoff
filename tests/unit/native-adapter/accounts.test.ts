import { describe, expect, it, vi } from "vitest";
import { NativeConnection, plain } from "@account-handoff/native-adapter";

describe("native optional account storage", () => {
  it("reads a newly created Pure with no vesting entry at the requested anchor", async () => {
    const address = `0x${"12".repeat(32)}`;
    const blockHash = `0x${"34".repeat(32)}` as const;
    const at = vi.fn().mockResolvedValue({
      query: {
        system: {
          account: async () => ({
            nonce: 0,
            data: { free: 10n, reserved: 2n, frozen: 0n },
          }),
        },
        proxy: { proxies: async () => [[], 2n] },
        revive: { originalAccount: async () => undefined },
        balances: { holds: async () => [], reserves: async () => [] },
        vesting: { vesting: async () => undefined },
      },
    });
    const connection = Object.create(
      NativeConnection.prototype,
    ) as NativeConnection;
    Object.defineProperty(connection, "api", { value: { at } });
    await expect(
      connection.readAccount(address, blockHash),
    ).resolves.toMatchObject({
      address,
      free: 10n,
      reserved: 2n,
      vesting: [],
      mappedTo: null,
    });
    expect(at).toHaveBeenCalledExactlyOnceWith(blockHash);
  });

  it("represents absent optional codec output as JSON null", () => {
    expect(plain(undefined)).toBeNull();
    expect(plain({ amount: 2n })).toEqual({ amount: "2" });
  });
});
