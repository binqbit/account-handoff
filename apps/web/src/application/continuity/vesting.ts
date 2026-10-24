import type { VestingTuple } from "@account-handoff/contracts";
import type { GrantHistoryEntry } from "@account-handoff/grant-adapter";
import { abiToNative } from "@account-handoff/domain";
import { bigint } from "./observations";

/** Bind the schedule to this grant's release, not another grant on the same P. */
export function releasedVestingSchedule(
  tuples: VestingTuple[],
  release: GrantHistoryEntry | null,
): VestingTuple | undefined {
  if (!release || release.eventName !== "MilestoneReleased") return;
  if (bigint(release.args.index) !== 0n) return;
  const blocks = bigint(release.args.vestingBlocks);
  if (blocks === 0n) return;
  // The qualified Vestry profile uses 18-decimal ABI amounts and 14-decimal native units.
  const locked = abiToNative(bigint(release.args.amount), 10000n);
  const perBlock = locked / blocks;
  if (locked === 0n || perBlock === 0n) return;
  return tuples.find(
    (tuple) =>
      tuple.locked === String(locked) &&
      tuple.perBlock === String(perBlock) &&
      tuple.startingBlock === String(release.blockNumber) &&
      tuple.clockDomain === "native-block-number",
  );
}
