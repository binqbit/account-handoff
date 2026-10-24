import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import {
  encodeApproval,
  encodeCreateGrant,
  encodeSubmission,
  vestryAbi,
  ZERO_ADDRESS,
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
});
