import { describe, expect, it } from "vitest";
import { decodeContractEstimate } from "@account-handoff/native-adapter";
const result = () => ({
  weightConsumed: { refTime: 500n, proofSize: 200n },
  weightRequired: { refTime: 1000n, proofSize: 300n },
  storageDeposit: { type: "Charge", value: 15n },
  maxStorageDeposit: { type: "Charge", value: 40n },
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
      storage: 40n,
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
    expect(() =>
      decodeContractEstimate({
        ...result(),
        maxStorageDeposit: { type: "Refund", value: 10n },
      }),
    ).toThrow("storage");
  });
  it("requires the V2 weight and peak deposit fields even when the final charge is refunded", () => {
    const { weightRequired: _weight, ...missingWeight } = result();
    expect(() =>
      decodeContractEstimate({
        ...missingWeight,
        gasRequired: { refTime: 1000n, proofSize: 300n },
      }),
    ).toThrow();
    expect(
      decodeContractEstimate({
        ...result(),
        storageDeposit: { type: "Refund", value: 15n },
      }).storage,
    ).toBe(40n);
  });
  it("decodes the exact result shape captured from the qualified LOCAL ReviveApi", () => {
    expect(
      decodeContractEstimate({
        weightConsumed: { refTime: "14250415", proofSize: "7299" },
        weightRequired: { refTime: "14250415", proofSize: "7299" },
        storageDeposit: { type: "Charge", value: "0" },
        maxStorageDeposit: { type: "Charge", value: "0" },
        gasConsumed: "7126",
        result: {
          isOk: true,
          isErr: false,
          value: {
            flags: { bits: 0 },
            data: "0x0000000000000000000000000000000000000000000000000000000000002710",
          },
        },
      }),
    ).toEqual({
      weight: { refTime: 17100499n, proofSize: 9782n },
      storage: 0n,
      data: "0x0000000000000000000000000000000000000000000000000000000000002710",
    });
  });
});
