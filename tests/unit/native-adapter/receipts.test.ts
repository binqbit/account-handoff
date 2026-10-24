import { describe, it, expect } from "vitest";
import type { ISubmittableResult } from "dedot/types";
import {
  classifyNativeReceipt,
  safeEndpoint,
} from "@account-handoff/native-adapter";
const hash = `0x${"11".repeat(32)}`;
function result(events: unknown[]): ISubmittableResult {
  return {
    txHash: hash,
    txIndex: 0,
    status: {
      type: "Finalized",
      value: { blockHash: hash, blockNumber: 1, txIndex: 0 },
    },
    events,
  } as ISubmittableResult;
}
function event(pallet: string, name: string, data: unknown = {}) {
  return {
    phase: { type: "ApplyExtrinsic", value: 0 },
    event: { pallet, palletEvent: { name, data } },
    topics: [],
  };
}
describe("native receipt and endpoint boundary", () => {
  it("never accepts wrapper success over a nested proxy failure", () => {
    const receipt = classifyNativeReceipt(
      result([
        event("Proxy", "ProxyExecuted", {
          result: { type: "Err", value: "NotProxy" },
        }),
        event("Multisig", "MultisigExecuted", { result: { type: "Ok" } }),
        event("System", "ExtrinsicSuccess"),
      ]),
    );
    expect(receipt.outerSuccess).toBe(true);
    expect(receipt.nestedSuccess).toBe(false);
    expect(receipt.businessExecuted).toBe(false);
  });
  it("does not report the business action executed on its first approval", () => {
    const receipt = classifyNativeReceipt(
      result([
        event("Multisig", "NewMultisig"),
        event("System", "ExtrinsicSuccess"),
      ]),
    );
    expect(receipt.nestedSuccess).toBe(true);
    expect(receipt.businessExecuted).toBe(false);
  });
  it("enforces real network class and credential-free endpoint selection", () => {
    expect(safeEndpoint("ws://127.0.0.1:9944", "LOCAL")).toBe(
      "ws://127.0.0.1:9944/",
    );
    expect(() => safeEndpoint("wss://example.org", "LOCAL")).toThrow();
    expect(() => safeEndpoint("ws://example.org", "DEMO")).toThrow();
    expect(() =>
      safeEndpoint("wss://user:password@example.org", "LIVE"),
    ).toThrow();
  });
});
