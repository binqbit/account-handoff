import { encodeAddress } from "@polkadot/util-crypto";

export type AddressFormat = "native" | "hex";

/** The connected wallet profiles use the generic Substrate SS58 prefix. */
export function displayAddress(
  value: string,
  format: AddressFormat = "native",
): string {
  return format === "native" && /^0x[0-9a-f]{64}$/i.test(value)
    ? encodeAddress(value.toLowerCase(), 42)
    : value;
}

export function compactAddress(value: string): string {
  return value.length > 24 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
