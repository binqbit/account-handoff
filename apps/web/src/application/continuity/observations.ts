import { canonicalJson } from "@account-handoff/contracts";
import type {
  AccountingLedger,
  EvidenceRef,
  VestingTuple,
} from "@account-handoff/contracts";
import { account, plain } from "@account-handoff/native-adapter";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected exact structured chain evidence");
  return value as Record<string, unknown>;
}
export function bigint(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    return BigInt(value);
  throw new Error("Invalid exact native quantity");
}
export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text identity");
  return value;
}
export function field(
  object: Record<string, unknown>,
  camel: string,
  snake: string,
): unknown {
  return object[camel] ?? object[snake];
}
export function schedules(value: unknown): VestingTuple[] {
  if (value === null) return [];
  if (!Array.isArray(value))
    throw new Error("Vesting observation is unavailable");
  return value.map((item) => {
    const raw = object(item);
    return {
      locked: bigint(raw.locked).toString(),
      perBlock: bigint(field(raw, "perBlock", "per_block")).toString(),
      startingBlock: bigint(
        field(raw, "startingBlock", "starting_block"),
      ).toString(),
      clockDomain: "native-block-number",
    };
  });
}
export function liabilities(
  value: unknown,
  evidence: EvidenceRef[],
): AccountingLedger["pureReasonHolds"] {
  if (!Array.isArray(value))
    throw new Error("Hold or reserve observations are unavailable");
  return value.map((item) => {
    const raw = object(item);
    return {
      reason: canonicalJson(plain(raw.id)),
      amountNative: bigint(raw.amount).toString(),
      evidence,
    };
  });
}
export function tupleIdentity(tuple: VestingTuple): string {
  return `${tuple.locked}:${tuple.perBlock}:${tuple.startingBlock}:${tuple.clockDomain}`;
}
export function roleAddress(value: unknown): string {
  if (typeof value === "string") return account(value);
  const address = object(value);
  if (address.type === "Id") return roleAddress(address.value);
  if (typeof address.raw === "string") return account(address.raw);
  throw new Error(
    "Proof requires a canonical native AccountId32, not an unresolved address index",
  );
}
