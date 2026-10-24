import { DomainError } from "./result.js";

export type Quantity<Unit extends string> = bigint & { readonly unit: Unit };
export type NativeBalance = Quantity<"native">;
export type AbiAmount = Quantity<"abi">;
export type BlockNumber = Quantity<"block">;

export function integer(input: string | bigint, bits = 128): bigint {
  if (typeof input === "string" && !/^(0|[1-9][0-9]*)$/.test(input))
    throw new DomainError(
      "InvalidInteger",
      "Expected canonical unsigned decimal integer",
    );
  const value = BigInt(input);
  if (value < 0n || value >= 1n << BigInt(bits))
    throw new DomainError("IntegerOverflow", `Value does not fit uint${bits}`);
  return value;
}

export function parseUnits(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    throw new DomainError("InvalidDecimals", "Unsupported asset decimals");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text))
    throw new DomainError(
      "InvalidAmount",
      "Expected a nonnegative decimal amount",
    );
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > decimals)
    throw new DomainError(
      "AmountPrecision",
      "Amount has more precision than the asset",
    );
  return integer(
    BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0") || "0"),
  );
}

export function formatUnits(value: bigint, decimals: number): string {
  integer(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    throw new DomainError("InvalidDecimals", "Unsupported asset decimals");
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
}

export function nativeToAbi(value: bigint, ratio: bigint): bigint {
  if (ratio <= 0n)
    throw new DomainError(
      "UnqualifiedRatio",
      "Native/ABI ratio must be positive",
    );
  return integer(integer(value) * ratio, 256);
}
export function abiToNative(value: bigint, ratio: bigint): bigint {
  if (ratio <= 0n || value % ratio !== 0n)
    throw new DomainError(
      "InexactConversion",
      "ABI amount is not exactly representable in native units",
    );
  return integer(value / ratio);
}

export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n)
    throw new DomainError(
      "InvalidDivision",
      "Expected a nonnegative dividend and positive divisor",
    );
  return (value + divisor - 1n) / divisor;
}
