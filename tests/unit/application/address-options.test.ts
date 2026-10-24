import { describe, expect, it } from "vitest";
import { encodeAddress } from "@polkadot/util-crypto";
import {
  addressKey,
  addressError,
  participantOptions,
} from "../../../apps/web/src/components/addresses/options";
import type { AppSnapshot } from "../../../apps/web/src/ui-contract";

const raw = `0x${"12".repeat(32)}`;
describe("address selection", () => {
  it("recognizes the same native identity across SS58 prefixes and AccountId32", () => {
    expect(addressKey(encodeAddress(raw, 0))).toBe(raw);
    expect(addressKey(encodeAddress(raw, 42))).toBe(raw);
    expect(addressKey(`  ${raw}  `)).toBe(raw);
  });
  it("keeps native identities and EVM contract addresses distinct", () => {
    const contract = `0x${"ab".repeat(20)}`;
    expect(addressKey(contract)).toBeNull();
    expect(addressKey(raw, "contract")).toBeNull();
    expect(addressKey(contract, "contract")).toBe(contract);
    expect(addressError("not an address", "native")).toContain("SS58");
    expect(addressError("", "native")).toBeNull();
  });
  it("combines wallet and participant labels without suggesting controller accounts as people", () => {
    const snapshot = {
      wallet: {
        accounts: [
          {
            address: encodeAddress(raw, 42),
            label: "Alice",
            source: "SubWallet",
          },
        ],
      },
      workspace: {
        oldController: {
          address: `0x${"34".repeat(32)}`,
          members: [{ address: raw, label: "A" }],
        },
        newController: {
          address: `0x${"56".repeat(32)}`,
          members: [{ address: encodeAddress(raw, 0), label: "A" }],
        },
        beneficiary: { address: `0x${"78".repeat(32)}` },
        funder: null,
        reviewers: [],
      },
    } as unknown as AppSnapshot;
    expect(participantOptions(snapshot)).toEqual([
      {
        address: encodeAddress(raw, 42),
        label: "Alice",
        detail:
          "Connected wallet · SubWallet · Original group M0 · New group M1",
      },
    ]);
  });
});
