import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";
import {
  scanGrantHistoryWithSource,
  roundAtSubmission,
  vestryAbi,
  type FinalizedHistorySource,
  type HistoryBlock,
  type HistoryEvent,
} from "@account-handoff/grant-adapter";
import type { Hex } from "@account-handoff/native-adapter";
const contract = `0x${"11".repeat(20)}` as Hex;
const signer = `0x${"22".repeat(20)}` as Hex;
const hash = (height: number) =>
  `0x${height.toString(16).padStart(64, "0")}` as Hex;
function emitted(
  name:
    | "GrantCreated"
    | "MilestoneSubmitted"
    | "ChangesRequested"
    | "MilestoneReleased",
  eventIndex = 0,
): HistoryEvent {
  const args =
    name === "GrantCreated"
      ? { grantId: 0n, funder: signer, grantee: contract }
      : name === "ChangesRequested"
        ? { grantId: 0n, index: 1n, reviewer: signer }
        : { grantId: 0n, index: name === "MilestoneReleased" ? 0n : 1n };
  const topics = encodeEventTopics({ abi: vestryAbi, eventName: name, args });
  const data =
    name === "GrantCreated"
      ? encodeAbiParameters(
          parseAbiParameters("address,uint256,address[],uint8"),
          [contract, 300000n, [signer, contract], 2],
        )
      : name === "MilestoneReleased"
        ? encodeAbiParameters(parseAbiParameters("uint256,uint32,uint256"), [
            180000n,
            1800,
            0n,
          ])
        : encodeAbiParameters(parseAbiParameters("string"), [
            name === "ChangesRequested" ? "revise" : "continued",
          ]);
  return {
    pallet: "Revive",
    name: "ContractEmitted",
    data: { contract, data, topics },
    eventIndex,
    txIndex: 0,
  };
}
function source(
  events: Record<number, HistoryEvent[]>,
): FinalizedHistorySource {
  return {
    finalizedHeight: async () => 4,
    block: async (height): Promise<HistoryBlock> => ({
      number: height,
      hash: hash(height),
      executionCompatible: true,
      events: events[height] ?? [],
      extrinsics: [{ bytes: "0x0100", call: { pallet: "Multisig" }, signer }],
    }),
  };
}

describe("finalized causal grant history", () => {
  it("keeps an otherwise complete history unresolved if its canonical range changes", async () => {
    const historySource = source({ 1: [emitted("GrantCreated")] });
    historySource.verifyCanonicalRange = async () => {
      throw new Error("canonical range changed");
    };
    const result = await scanGrantHistoryWithSource(historySource, {
      contract,
      grantId: "0",
      fromBlock: 1,
      toBlock: 4,
    });
    expect(result.complete).toBe(false);
    expect(result.scope).toBe("ReconciliationRequired");
    expect(result.blockers).toContain("canonical range changed");
  });
  it("derives round0 from the ordered creation-to-submission history", async () => {
    const result = await scanGrantHistoryWithSource(
      source({
        1: [emitted("GrantCreated")],
        2: [emitted("MilestoneReleased")],
        4: [emitted("MilestoneSubmitted")],
      }),
      { contract, grantId: "0", fromBlock: 1, toBlock: 4 },
    );
    // A release with no observed initial submission remains incomplete: no fabricated baseline.
    expect(result.complete).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/Release/);
  });
  it("attributes the precise target round and preserves an external reopening breach", async () => {
    const clean = await scanGrantHistoryWithSource(
      source({
        1: [emitted("GrantCreated")],
        4: [emitted("MilestoneSubmitted")],
      }),
      { contract, grantId: "0", fromBlock: 1, toBlock: 4 },
    );
    expect(clean.complete).toBe(true);
    expect(clean.scope).toBe("EligibleSingleRound");
    expect(roundAtSubmission(clean, { blockHash: hash(4), txIndex: 0 })).toBe(
      0,
    );
    const changed = await scanGrantHistoryWithSource(
      source({
        1: [emitted("GrantCreated")],
        3: [emitted("ChangesRequested")],
        4: [emitted("MilestoneSubmitted")],
      }),
      { contract, grantId: "0", fromBlock: 1, toBlock: 4 },
    );
    expect(changed.complete).toBe(true);
    expect(changed.scope).toBe("ScopeBreached");
    expect(roundAtSubmission(changed, { blockHash: hash(4), txIndex: 0 })).toBe(
      1,
    );
  });
  it("keeps missing or upgrade-boundary history unresolved and rejects unfinalized ranges", async () => {
    const missing = source({ 1: [emitted("GrantCreated")] });
    const original = missing.block;
    missing.block = async (height) => {
      if (height === 2) throw new Error("pruned");
      return original(height);
    };
    const result = await scanGrantHistoryWithSource(missing, {
      contract,
      grantId: "0",
      fromBlock: 1,
      toBlock: 4,
    });
    expect(result.complete).toBe(false);
    expect(result.scannedThrough).toBe(1);
    expect(
      roundAtSubmission(result, { blockHash: hash(4), txIndex: 0 }),
    ).toBeNull();
    await expect(
      scanGrantHistoryWithSource(source({}), {
        contract,
        grantId: "0",
        fromBlock: 1,
        toBlock: 5,
      }),
    ).rejects.toThrow(/unfinalized/);
  });
  it("bounds concurrent reads and reduces out-of-order results chronologically", async () => {
    const base = source({
      1: [emitted("GrantCreated")],
      12: [emitted("MilestoneSubmitted")],
    });
    let active = 0,
      peak = 0;
    const completed: number[] = [],
      progress: number[] = [];
    const result = await scanGrantHistoryWithSource(
      {
        finalizedHeight: async () => 12,
        async block(height) {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 20 - height));
          completed.push(height);
          active--;
          return base.block(height);
        },
      },
      {
        contract,
        grantId: "0",
        fromBlock: 1,
        toBlock: 12,
        onProgress: (done) => progress.push(done),
      },
    );
    expect(peak).toBe(8);
    expect(completed[0]).not.toBe(1);
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(result.entries.map((entry) => entry.blockNumber)).toEqual([1, 12]);
    expect(result.scope).toBe("EligibleSingleRound");
  });
  it("does not accept prefetched blocks beyond a failure or cancellation", async () => {
    const base = source({
      1: [emitted("GrantCreated")],
      4: [emitted("MilestoneSubmitted")],
    });
    const failed = await scanGrantHistoryWithSource(
      {
        ...base,
        async block(height) {
          if (height === 2) throw new Error("unavailable block");
          return base.block(height);
        },
      },
      { contract, grantId: "0", fromBlock: 1, toBlock: 4 },
    );
    expect(failed.complete).toBe(false);
    expect(failed.scannedThrough).toBe(1);
    expect(failed.entries.map((entry) => entry.blockNumber)).toEqual([1]);
    const controller = new AbortController();
    const cancelled = await scanGrantHistoryWithSource(base, {
      contract,
      grantId: "0",
      fromBlock: 1,
      toBlock: 4,
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    });
    expect(cancelled.complete).toBe(false);
    expect(cancelled.scannedThrough).toBe(1);
    expect(cancelled.blockers).toContain("History scan canceled");
  });
});
