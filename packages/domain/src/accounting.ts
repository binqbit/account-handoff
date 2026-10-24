import type {
  VestingTuple,
  AccountingLedger,
} from "@account-handoff/contracts";
import { ceilDiv, integer } from "./units.js";
import { DomainError } from "./result.js";

export interface AccountResources {
  free: bigint;
  frozen: bigint;
  reserved: bigint;
  existentialDeposit: bigint;
}
export function spendable(resources: AccountResources): bigint {
  const blocked =
    resources.frozen > resources.existentialDeposit
      ? resources.frozen
      : resources.existentialDeposit;
  return resources.free > blocked ? resources.free - blocked : 0n;
}
export function resourceShortfall(
  resources: AccountResources,
  needed: bigint,
): bigint {
  const available = spendable(resources);
  return needed > available ? needed - available : 0n;
}

export function vestingRemaining(tuple: VestingTuple, at: bigint): bigint {
  const locked = integer(tuple.locked),
    perBlock = integer(tuple.perBlock),
    start = integer(tuple.startingBlock);
  if (perBlock === 0n)
    throw new DomainError("InvalidVesting", "Vesting rate cannot be zero");
  const elapsed = at > start ? at - start : 0n;
  const vested = elapsed * perBlock;
  return vested >= locked ? 0n : locked - vested;
}
export function vestingDuration(tuple: VestingTuple): bigint {
  return ceilDiv(integer(tuple.locked), integer(tuple.perBlock));
}

export function vestingMultiset(
  tuples: readonly VestingTuple[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const tuple of tuples) {
    const key = `${integer(tuple.locked)}:${integer(tuple.perBlock)}:${integer(tuple.startingBlock)}:${tuple.clockDomain}`;
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}
export function hasPreservedSchedule(
  before: readonly VestingTuple[],
  after: readonly VestingTuple[],
): boolean {
  const expected = vestingMultiset(before),
    actual = vestingMultiset(after);
  return [...expected].every(([key, count]) => actual.get(key) === count);
}

export function assessBacking(ledger: AccountingLedger): {
  backed: boolean;
  unexplained: bigint;
} {
  const held = ledger.pureReasonHolds.reduce(
    (sum, x) => sum + integer(x.amountNative),
    0n,
  );
  const named = ledger.pureNamedReserves.reduce(
    (sum, x) => sum + integer(x.amountNative),
    0n,
  );
  const liabilities =
    held +
    named +
    integer(ledger.pureOtherTracedReservedLiabilitiesNative) +
    integer(ledger.pureProxyIncrementNative);
  const reserved = integer(ledger.pureReservedNative);
  return {
    backed:
      ledger.status === "reconciled" &&
      reserved >= liabilities &&
      ledger.unexplainedReservedDeltaNative === "0",
    unexplained: reserved - liabilities,
  };
}
