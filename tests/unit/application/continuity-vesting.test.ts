import { describe, expect, it } from "vitest";
import type { GrantHistoryEntry } from "@account-handoff/grant-adapter";
import {
  hasMaturedReleaseSchedule,
  releasedVestingSchedule,
} from "../../../apps/web/src/application/continuity/vesting";

const tuple = (startingBlock: string, locked = "1800000000000000") => ({
  locked,
  perBlock: "1000000000000",
  startingBlock,
  clockDomain: "native-block-number",
});
const release: GrantHistoryEntry = {
  eventName: "MilestoneReleased",
  blockNumber: 5822,
  blockHash: `0x${"11".repeat(32)}`,
  eventIndex: 1,
  txIndex: 2,
  contract: `0x${"22".repeat(20)}`,
  grantId: "5",
  rawExtrinsic: null,
  decodedCall: null,
  signer: null,
  roundBefore: 0,
  args: { index: "0", amount: "18000000000000000000", vestingBlocks: "1800" },
};

describe("grant-specific vesting identity", () => {
  it("selects this grant's release when older grants share the beneficiary", () => {
    const target = tuple("5822");
    expect(
      releasedVestingSchedule([tuple("4396"), tuple("5068"), target], release),
    ).toBe(target);
  });
  it("does not replace missing release evidence with another active schedule", () => {
    expect(releasedVestingSchedule([tuple("5068")], release)).toBeUndefined();
    expect(releasedVestingSchedule([tuple("5822")], null)).toBeUndefined();
    expect(
      releasedVestingSchedule([tuple("5822", "1")], release),
    ).toBeUndefined();
  });
  it("rejects another milestone and malformed unit conversion", () => {
    expect(
      releasedVestingSchedule([tuple("5822")], {
        ...release,
        args: { ...release.args, index: "1" },
      }),
    ).toBeUndefined();
    expect(() =>
      releasedVestingSchedule([tuple("5822")], {
        ...release,
        args: { ...release.args, amount: "10001" },
      }),
    ).toThrow();
  });
  it("requires complete release provenance and maturity before maintenance", () => {
    const target = tuple("5822");
    expect(
      hasMaturedReleaseSchedule([target], [target], release, true, 7622n),
    ).toBe(true);
    expect(
      hasMaturedReleaseSchedule([target], [target], release, true, 7621n),
    ).toBe(false);
    expect(
      hasMaturedReleaseSchedule([target], [target], release, false, 7622n),
    ).toBe(false);
    expect(
      hasMaturedReleaseSchedule([target], [target], null, true, 7622n),
    ).toBe(false);
    expect(hasMaturedReleaseSchedule([target], [], release, true, 7622n)).toBe(
      false,
    );
    expect(
      hasMaturedReleaseSchedule(
        [tuple("5068")],
        [target],
        release,
        true,
        7622n,
      ),
    ).toBe(false);
  });
});
