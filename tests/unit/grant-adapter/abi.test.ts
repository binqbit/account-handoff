import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, getAddress } from "viem";
import type { NativeConnection } from "@account-handoff/native-adapter";
import {
  encodeApproval,
  encodeCreateGrant,
  encodeSubmission,
  vestryAbi,
  ZERO_ADDRESS,
  readGrant,
} from "@account-handoff/grant-adapter";
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
describe("controlled unchanged Vestry ABI", () => {
  it("encodes the same beneficiary and two distinct reviewers without a forwarding contract", () => {
    const base = {
      deadline: 2000000000n,
      metricTarget: ZERO_ADDRESS,
      metricSelector: "0x00000000" as const,
      metricMin: 0n,
    };
    const data = encodeCreateGrant(
      address("1"),
      [address("2"), address("3")],
      [
        { ...base, amount: 18n * 10n ** 18n, vestingBlocks: 1800 },
        { ...base, amount: 12n * 10n ** 18n, vestingBlocks: 0 },
      ],
    );
    const decoded = decodeFunctionData({ abi: vestryAbi, data });
    expect(decoded.functionName).toBe("createGrant");
    expect(decoded.args?.[0]).toBe(address("1"));
  });
  it("counts evidence in UTF-8 bytes and preserves exact text", () => {
    const evidence = "ї".repeat(512);
    expect(
      decodeFunctionData({
        abi: vestryAbi,
        data: encodeSubmission(0n, 1, evidence),
      }).args,
    ).toEqual([0n, 1n, evidence]);
    expect(() => encodeSubmission(0n, 1, evidence + "ї")).toThrow();
    expect(() => encodeSubmission(0n, 2, "unsupported")).toThrow();
  });
  it("keeps approval a direct contract operation for a specific grant and milestone", () => {
    expect(
      decodeFunctionData({ abi: vestryAbi, data: encodeApproval(7n, 0) }).args,
    ).toEqual([7n, 0n]);
    expect(() => encodeApproval(-1n, 0)).toThrow();
  });
  it("canonicalizes checksummed ABI addresses before native identity comparison", async () => {
    const grantee = "0x24e53fbb9c8b13e4a7e82484f65354bfe3cc4d10" as const;
    const funder = "0x203aedc6e1ee061f55ec52309d5ac8674d4e8352" as const;
    const milestone = {
      amount: 10_000n,
      deadline: 2_000_000_000n,
      vestingBlocks: 10,
      approvals: 0,
      round: 0,
      state: 0,
      metricTarget: grantee,
      metricSelector: "0x00000000" as const,
      metricMin: 0n,
    };
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(
        encodeFunctionResult({
          abi: vestryAbi,
          functionName: "grants",
          result: [funder, 2, 2, grantee, ZERO_ADDRESS],
        }),
      )
      .mockResolvedValue(
        encodeFunctionResult({
          abi: vestryAbi,
          functionName: "getMilestone",
          result: milestone,
        }),
      );
    const connection = { readContract } as unknown as NativeConnection;
    expect(getAddress(grantee)).not.toBe(grantee);
    const result = await readGrant(
      connection,
      address("1"),
      address("2"),
      0n,
      `0x${"11".repeat(32)}`,
    );
    expect(result.grantee).toBe(grantee);
    expect(result.funder).toBe(funder);
    expect(
      result.milestones.every((item) => item.metricTarget === grantee),
    ).toBe(true);
  });
});
