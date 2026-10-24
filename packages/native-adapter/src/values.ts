import { AccountId32 } from "dedot/codecs";
import { keccak256 } from "viem";
import type { Hex, Weight } from "./types";

export function plain(value: unknown): unknown {
  const serialized = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  return serialized === undefined ? null : JSON.parse(serialized);
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object from the native codec");
  return value as Record<string, unknown>;
}
export function hex(value: unknown, bytes?: number): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)
  )
    throw new Error("Invalid hexadecimal bytes");
  return value.toLowerCase() as Hex;
}
export function account(value: string): Hex {
  return hex(new AccountId32(value).raw, 32);
}
export function contractAddress(value: string): Hex {
  const raw = account(value);
  if (raw.endsWith("ee".repeat(12))) return hex(raw.slice(0, 42), 20);
  return hex(`0x${keccak256(raw).slice(-40)}`, 20);
}
export function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value))
    return BigInt(value);
  throw new Error("Invalid exact native integer");
}
export function number(value: unknown): number {
  const n = integer(value);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Native integer exceeds the safe range");
  return Number(n);
}
export function weight(value: unknown): Weight {
  const w = object(value);
  return { refTime: integer(w["refTime"]), proofSize: integer(w["proofSize"]) };
}
