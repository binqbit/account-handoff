import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  abiToNative,
  formatUnits,
  integer,
  nativeToAbi,
  parseUnits,
  vestingDuration,
  vestingRemaining,
  hasMaturedPreservedSchedule,
} from "@account-handoff/domain";

describe("integer units and native vesting", () => {
  it("GC-U05: rejects silent rounding and unsafe width", () => {
    expect(parseUnits("18.0001", 4)).toBe(180001n);
    expect(formatUnits(180001n, 4)).toBe("18.0001");
    expect(() => parseUnits("0.00001", 4)).toThrow();
    expect(() => integer("01")).toThrow();
    expect(() => integer(256n, 8)).toThrow();
    expect(() => abiToNative(10001n, 10000n)).toThrow();
  });
  it("roundtrips independently generated native values at the qualified ratio", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 28n }),
        (value) => abiToNative(nativeToAbi(value, 10000n), 10000n) === value,
      ),
      { seed: 240102, numRuns: 100 },
    );
  });
  it("GC-V04: duration uses ceiling and remaining value follows the supplied chain clock", () => {
    const tuple = {
      locked: "10",
      perBlock: "3",
      startingBlock: "100",
      clockDomain: "system",
    };
    expect(vestingDuration(tuple)).toBe(4n);
    expect(vestingRemaining(tuple, 99n)).toBe(10n);
    expect(vestingRemaining(tuple, 103n)).toBe(1n);
    expect(vestingRemaining(tuple, 104n)).toBe(0n);
  });
  it("permits matured maintenance only for a nonempty, preserved native schedule", () => {
    const tuple = {
      locked: "10",
      perBlock: "3",
      startingBlock: "100",
      clockDomain: "native-block-number",
    };
    expect(hasMaturedPreservedSchedule([tuple], [tuple], 103n)).toBe(false);
    expect(hasMaturedPreservedSchedule([tuple], [tuple], 104n)).toBe(true);
    expect(hasMaturedPreservedSchedule([], [], 104n)).toBe(false);
    expect(hasMaturedPreservedSchedule([tuple], [], 104n)).toBe(false);
    expect(hasMaturedPreservedSchedule([tuple], [tuple, tuple], 104n)).toBe(
      false,
    );
    expect(
      hasMaturedPreservedSchedule(
        [{ ...tuple, clockDomain: "unknown" }],
        [tuple],
        104n,
      ),
    ).toBe(false);
  });
});
