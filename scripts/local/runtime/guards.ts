import type { Hex } from "@account-handoff/native-adapter";
export function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export function valueHex(value: unknown): Hex {
  if (typeof value === "string") return value as Hex;
  if (
    value &&
    typeof value === "object" &&
    "raw" in value &&
    typeof value.raw === "string"
  )
    return value.raw as Hex;
  throw new Error("Expected a native hexadecimal identity in finalized event");
}
