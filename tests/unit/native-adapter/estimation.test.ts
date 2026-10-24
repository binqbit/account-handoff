import { describe, expect, it } from "vitest";
import { decodeContractEstimate } from "@account-handoff/native-adapter";
const result = () => ({
  gasRequired: { refTime: 1000n, proofSize: 300n },
  storageDeposit: { type: "Charge", value: 15n },
  result: {
    isOk: true,
    isErr: false,
    value: { flags: { bits: 0 }, data: "0x1234" },
  },
});
describe("metadata-shaped Revive estimation", () => {
  it("decodes the native Result discriminant and return-flag struct", () => {
    expect(decodeContractEstimate(result())).toEqual({
      weight: { refTime: 1201n, proofSize: 1384n },
      storage: 15n,
      data: "0x1234",
    });
  });
  it("rejects reverted and failed execution rather than returning a fee quote", () => {
    const reverted = result();
    reverted.result.value.flags.bits = 1;
    expect(() => decodeContractEstimate(reverted)).toThrow("reverted");
    expect(() =>
      decodeContractEstimate({
        ...result(),
        result: { isOk: false, isErr: true, err: { type: "BadOrigin" } },
      }),
    ).toThrow("failed");
  });
  it("refuses unknown storage-result variants", () => {
    expect(() =>
      decodeContractEstimate({
        ...result(),
        storageDeposit: { type: "Unknown", value: 0n },
      }),
    ).toThrow("storage");
  });
});
