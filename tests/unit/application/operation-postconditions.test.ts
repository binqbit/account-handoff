import { describe, expect, it, vi } from "vitest";
import { readGrant } from "@account-handoff/grant-adapter";
import { contractAddress } from "@account-handoff/native-adapter";
import { operationPostconditions } from "../../../apps/web/src/application/operation-postconditions";
import { account, profile, HASH, DIGEST, M0, M1 } from "../../fixtures/core";

vi.mock("@account-handoff/grant-adapter", () => ({ readGrant: vi.fn() }));

describe("continuation receipt vesting provenance", () => {
  it.each([
    [109, "preserved", "passed"],
    [110, "preserved", "passed"],
    [110, "changed", "failed"],
    [110, "duplicated", "failed"],
  ] as const)(
    "at native block %s, %s schedule is %s",
    async (height, condition, expected) => {
      const P = account(20);
      const tuple = { locked: "100", perBlock: "1", startingBlock: 10 };
      const current =
        condition === "changed"
          ? [{ ...tuple, locked: "101" }]
          : condition === "duplicated"
            ? [tuple, tuple]
            : [tuple];
      const grant = {
        grantee: contractAddress(P),
        funder: `0x${"22".repeat(20)}`,
      };
      vi.mocked(readGrant).mockResolvedValue(grant as never);
      const fingerprint = {
        genesis: HASH,
        runtimeCodeHash: HASH,
        metadataSha256: DIGEST,
        specVersion: 1,
        transactionVersion: 1,
        metadataVersion: 14,
        anchor: { hash: HASH, number: height },
      };
      const result = await operationPostconditions(
        {
          workspace: {
            pure: P,
            contract: `0x${"33".repeat(20)}`,
            grantId: "0",
            M0,
            M1,
            baseline: { account: { vesting: [tuple] }, grant },
          } as never,
          chain: { profile: await profile() } as never,
          connection: {
            fingerprint: vi.fn().mockResolvedValue(fingerprint),
            readAccount: vi.fn(async (address) =>
              address === P
                ? { address, vesting: current }
                : { address, reserved: 0n },
            ),
          } as never,
          accounting: vi
            .fn()
            .mockResolvedValue({
              status: "reconciled",
              unexplainedReservedDeltaNative: "0",
            }),
        },
        {
          actionId: "GRC-GRANT-SUBMIT-M1",
          phase: "multisig_final",
        } as never,
        {
          nestedSuccess: true,
          failure: null,
          blockHash: HASH,
          blockNumber: height,
        } as never,
      );
      expect(
        result.find((item) => item.id === "vesting-provenance")?.result,
      ).toBe(expected);
      expect(
        result.find((item) => item.id === "grant-beneficiary")?.result,
      ).toBe("passed");
    },
  );
});
