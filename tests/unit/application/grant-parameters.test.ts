import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { vestryAbi } from "@account-handoff/grant-adapter";
import { operationParameters } from "../../../apps/web/src/application/operation-parameters";

const UNIT = 10n ** 14n;
const native = (byte: string) => `0x${byte.repeat(64)}`;
const address = `0x${"ab".repeat(20)}`;
function prepare(minimum = 10n * UNIT) {
  const estimate = vi.fn(async () => ({
    weight: { refTime: 1_000_000n, proofSize: 1024n },
    storage: UNIT,
    data: "0x",
  }));
  const connection = {
    api: { consts: { vesting: { minVestedTransfer: minimum } } },
    currentBlockTime: async () => 1_800_000_000_000n,
    estimateContract: estimate,
  };
  const chain = {
    localDescriptor: { contract: { address } },
    fingerprint: { tokenDecimals: 14, tokenSymbol: "AHLOCAL" },
  };
  return {
    estimate,
    run: (amount = "10", blocks = "50") =>
      operationParameters(
        { chain, connection } as unknown as Parameters<
          typeof operationParameters
        >[0],
        "GRC-GRANT-CREATE",
        {
          contract: address,
          firstAmount: amount,
          secondAmount: "0.1",
          deadlineDays: "7",
          vestingBlocks: blocks,
        },
        {
          pure: native("1"),
          participants: { F: native("2"), R1: native("3"), R2: native("4") },
        } as unknown as Parameters<typeof operationParameters>[3],
        native("2"),
      ),
  };
}

describe("grant authoring respects native vesting limits", () => {
  it("encodes both minimal tranches without changing their native value", async () => {
    const fixture = prepare();
    const result = await fixture.run();
    const call = decodeFunctionData({ abi: vestryAbi, data: result.abi! });
    expect(call.functionName).toBe("createGrant");
    if (call.functionName !== "createGrant") throw new Error("Wrong call");
    expect(call.args[4][0]!.amount).toBe(10n * UNIT * 10000n);
    expect(call.args[4][0]!.vestingBlocks).toBe(50);
    expect(call.args[4][1]!.amount).toBe((UNIT / 10n) * 10000n);
    expect(result.resources.valueNative).toBe(String(10n * UNIT + UNIT / 10n));
    expect(fixture.estimate).toHaveBeenCalledOnce();
  });

  it("rejects a tranche that creation would accept but native vesting would refuse", async () => {
    const fixture = prepare();
    await expect(fixture.run("1")).rejects.toThrow("at least 10 AHLOCAL");
    expect(fixture.estimate).not.toHaveBeenCalled();
  });

  it("uses the runtime minimum instead of a hardcoded token amount", async () => {
    const fixture = prepare(20n * UNIT);
    await expect(fixture.run("10")).rejects.toThrow("at least 20 AHLOCAL");
    expect(fixture.estimate).not.toHaveBeenCalled();
  });

  it("rejects floor division that would extend the requested vesting duration", async () => {
    const fixture = prepare();
    await expect(fixture.run("10", "6")).rejects.toThrow("unlock evenly");
    expect(fixture.estimate).not.toHaveBeenCalled();
  });

  it("retains the existing divisible LOCAL demonstration amount and duration", async () => {
    const fixture = prepare();
    await expect(fixture.run("18", "1800")).resolves.toBeDefined();
  });
});
