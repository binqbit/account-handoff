import { describe, expect, it } from "vitest";
import {
  classifyAuthority,
  isNormalAccount,
  makeController,
  normalizeIdentity,
  otherSignatories,
} from "@account-handoff/domain";
import type { ProxyTuple } from "@account-handoff/contracts";
import { account, M0, M1, participants } from "../../fixtures/core.js";

describe("native identity and authority", () => {
  it("verifies the current controller without a planned replacement", () => {
    expect(
      classifyAuthority(
        [{ delegate: M0.account, proxyType: "Any", delay: "0" }],
        M0.account,
        null,
      ),
    ).toBe("M0Only");
    expect(
      classifyAuthority(
        [{ delegate: M1.account, proxyType: "Any", delay: "0" }],
        M0.account,
        null,
      ),
    ).toBe("UnexpectedSet");
  });
  it("normalizes raw identity and excludes the unselected stateless class", () => {
    expect(
      normalizeIdentity(account(170).toUpperCase().replace("0X", "0x")),
    ).toBe(account(170));
    expect(() => normalizeIdentity("0x1234")).toThrow();
    expect(isNormalAccount(`0x${"01".repeat(20)}${"ee".repeat(12)}`)).toBe(
      false,
    );
  });
  it("GC-U02: sorts before derivation and rejects duplicate members/threshold drift", () => {
    const seen: string[][] = [];
    const codec = {
      deriveMultisig(members: readonly string[]) {
        seen.push([...members]);
        return M0.account;
      },
    };
    expect(
      makeController(
        [participants.C, participants.A, participants.B],
        2,
        "M0",
        codec,
      ).account,
    ).toBe(M0.account);
    expect(seen[0]).toEqual([participants.A, participants.B, participants.C]);
    expect(() =>
      makeController(
        [participants.A, participants.A, participants.C],
        2,
        "M0",
        codec,
      ),
    ).toThrow();
    expect(() => makeController(M0.members, 1, "M0", codec)).toThrow();
    expect(otherSignatories(M0, participants.A)).toEqual([
      participants.B,
      participants.C,
    ]);
  });
  it("SG-12: extra authority is divergence even when the old controller is absent", () => {
    expect(
      classifyAuthority(
        [
          { delegate: M0.account, proxyType: "Any", delay: "0" },
          { delegate: M1.account, proxyType: "Any", delay: "0" },
        ],
        M0.account,
        M1.account,
      ),
    ).toBe("DualControl");
    expect(
      classifyAuthority(
        [{ delegate: M1.account, proxyType: "Any", delay: "0" }],
        M0.account,
        M1.account,
      ),
    ).toBe("M1Only");
    expect(
      classifyAuthority(
        [
          {
            delegate: M1.account,
            proxyType: "Any",
            delay: "1",
          } as unknown as ProxyTuple,
        ],
        M0.account,
        M1.account,
      ),
    ).toBe("UnexpectedSet");
    expect(
      classifyAuthority(
        [
          { delegate: M1.account, proxyType: "Any", delay: "0" },
          { delegate: account(11), proxyType: "Any", delay: "0" },
        ],
        M0.account,
        M1.account,
      ),
    ).toBe("UnexpectedSet");
    expect(classifyAuthority(null, M0.account, M1.account)).toBe("Unknown");
  });
});
