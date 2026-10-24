import { describe, expect, it } from "vitest";
import { classifyNativeOutcome } from "@account-handoff/evidence";
import type { EventRecord } from "@account-handoff/contracts";
import { evidence } from "../../fixtures/core.js";
const event = (
  pallet: string,
  name: string,
  index: string,
  result?: string,
): EventRecord => ({
  nativeEventIndex: index,
  extrinsicIndex: "2",
  pallet,
  event: name,
  contractEmitter: null,
  abiLogOrdinal: null,
  rawEvidence: evidence,
  decoded: result ? { result } : {},
});

describe("layered native receipts", () => {
  it("GC-N: preserves business failure under outer success and consumed multisig", () => {
    const result = classifyNativeOutcome(
      [
        event("Proxy", "ProxyExecuted", "0", "failure"),
        event("Multisig", "MultisigExecuted", "1", "success"),
        event("System", "ExtrinsicSuccess", "2"),
      ],
      "multisig_proxy",
      "2",
    );
    expect(result.businessEffect).toBe("failed");
    expect(result.proposalConsumed).toBe(true);
  });
  it("does not treat missing nested evidence as successful execution", () => {
    expect(
      classifyNativeOutcome(
        [event("System", "ExtrinsicSuccess", "0")],
        "multisig_proxy",
        "2",
      ).businessEffect,
    ).toBe("unknown");
  });
  it("first approval is successful while the business action is not attempted", () => {
    const result = classifyNativeOutcome(
      [
        event("Multisig", "NewMultisig", "0"),
        event("System", "ExtrinsicSuccess", "1"),
      ],
      "multisig_proxy",
      "2",
    );
    expect(result.status).toBe("finalized_success");
    expect(result.businessEffect).toBe("not_attempted");
    expect(result.proposalConsumed).toBe(false);
  });
  it("refuses reversed nested event order", () => {
    const result = classifyNativeOutcome(
      [
        event("Multisig", "MultisigExecuted", "0", "success"),
        event("Proxy", "ProxyExecuted", "1", "success"),
        event("System", "ExtrinsicSuccess", "2"),
      ],
      "multisig_proxy",
      "2",
    );
    expect(result.status).toBe("unresolved");
  });
});
