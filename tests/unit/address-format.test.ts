import { describe, expect, it } from "vitest";
import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { displayAddress } from "../../apps/web/src/components/addresses/format";

const native =
  "0xbea7b099dfc3f95317ed6c65afcb221a8556a62a1265bfab6a92375edc2ae301";
const ss58 = "5GNgmazxmCPxn7Hcp3hXyjqnKNWHWgqXnmWVk3Sp4hwQWeku";

describe("address presentation", () => {
  it("shows a native AccountId in the connected wallet's SS58 format", () => {
    expect(displayAddress(native)).toBe(ss58);
    expect(u8aToHex(decodeAddress(displayAddress(native)))).toBe(native);
  });
  it("preserves an already formatted wallet address", () => {
    expect(displayAddress(ss58)).toBe(ss58);
  });
  it("keeps H160 contract recipients in their own address format", () => {
    const recipient = "0x0f38d01d63e8c022647695856a17fbd6964bd8cb";
    expect(displayAddress(recipient)).toBe(recipient);
    expect(displayAddress(recipient, "hex")).toBe(recipient);
  });
  it("does not interpret an explicitly typed hash as a native account", () => {
    expect(displayAddress(native, "hex")).toBe(native);
  });
});
