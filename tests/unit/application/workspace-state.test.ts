import { describe, expect, it } from "vitest";
import { classifyAuthority } from "@account-handoff/domain";
import {
  advanceHandoff,
  createWorkspaceRecord,
  planHandoff,
  restoreWorkspace,
} from "../../../apps/web/src/application/workspace-state";
import {
  currentHandoffHistory,
  hasHandoff,
} from "../../../apps/web/src/application/models";
import type { WorkspaceInput } from "../../../apps/web/src/ui-contract";

const address = (value: number) =>
  `0x${value.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const input = (): WorkspaceInput => ({
  name: "Research team",
  oldMembers: [address(1), address(2), address(3)],
  threshold: 2,
  funder: address(5),
  reviewers: [address(6), address(7)],
});

describe("workspace lifecycle", () => {
  it("saves and restores a current multisig without inventing a replacement", () => {
    const workspace = createWorkspaceRecord(input(), "LOCAL", address(20));
    expect(workspace.M1).toBeNull();
    expect(workspace.participants.D).toBeNull();
    expect(restoreWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(
      workspace,
    );
    expect(
      classifyAuthority(
        [{ delegate: workspace.M0.account, proxyType: "Any", delay: "0" }],
        workspace.M0.account,
        null,
      ),
    ).toBe("M0Only");
    expect(
      classifyAuthority(
        [{ delegate: address(30), proxyType: "Any", delay: "0" }],
        workspace.M0.account,
        null,
      ),
    ).toBe("UnexpectedSet");
  });

  it("checks the supplied multisig address against its exact members", () => {
    const current = createWorkspaceRecord(input(), "LOCAL", address(20));
    expect(
      createWorkspaceRecord(
        { ...input(), controllerAddress: current.M0.account },
        "LOCAL",
        address(20),
      ).M0,
    ).toEqual(current.M0);
    expect(() =>
      createWorkspaceRecord(
        { ...input(), controllerAddress: address(30) },
        "LOCAL",
        address(20),
      ),
    ).toThrow("does not match");
  });

  it("plans the replacement later and preserves beneficiary, grant and history", () => {
    const current = createWorkspaceRecord(
      {
        ...input(),
        beneficiary: address(8),
        contract: `0x${"ab".repeat(20)}`,
        grantId: "0",
      },
      "LOCAL",
      address(20),
    );
    const next = planHandoff(current, [address(2), address(3), address(4)]);
    expect(current.M1).toBeNull();
    expect(next.M1?.members).toEqual([address(2), address(3), address(4)]);
    expect(next.M0).toEqual(current.M0);
    expect(next.pure).toBe(current.pure);
    expect(next.contract).toBe(current.contract);
    expect(next.grantId).toBe("0");
    expect(next.history).toEqual(current.history);
    expect(() =>
      planHandoff(next, [address(1), address(2), address(4)]),
    ).toThrow("already planned");
  });

  it("keeps the Pure creator and grant identity across consecutive handoffs", () => {
    const initial = createWorkspaceRecord(
      {
        ...input(),
        beneficiary: address(8),
        contract: `0x${"ab".repeat(20)}`,
        grantId: "0",
      },
      "LOCAL",
      address(20),
    );
    const first = planHandoff(initial, [address(1), address(2), address(4)]);
    if (!hasHandoff(first)) throw new Error("Missing test handoff");
    const current = advanceHandoff(first, "receipt:first");
    expect(current.M0.account).toBe(first.M1.account);
    expect(current.creator).toEqual(initial.M0);
    expect(current.M1).toBeNull();
    const second = planHandoff(current, [address(1), address(4), address(5)]);
    if (!hasHandoff(second)) throw new Error("Missing test handoff");
    const after = advanceHandoff(second, "receipt:second");
    expect(after.handoffs?.map((item) => item.removalReceiptId)).toEqual([
      "receipt:first",
      "receipt:second",
    ]);
    expect(after.handoffs?.[1]?.from.account).toBe(first.M1.account);
    expect(after.creator).toEqual(initial.M0);
    expect([after.pure, after.contract, after.grantId]).toEqual([
      initial.pure,
      initial.contract,
      initial.grantId,
    ]);
    expect(currentHandoffHistory(after)).toEqual([]);
    expect(
      restoreWorkspace(JSON.parse(JSON.stringify(after))).handoffs,
    ).toEqual(after.handoffs);
  });

  it("rejects an unchanged or unsupported replacement", () => {
    const current = createWorkspaceRecord(input(), "LOCAL", address(20));
    expect(() => planHandoff(current, input().oldMembers)).toThrow(
      "replaces one",
    );
    expect(() =>
      planHandoff(current, [address(4), address(5), address(6)]),
    ).toThrow("replaces one");
  });

  it("restores legacy workspaces with a preconfigured handoff", () => {
    const legacy = createWorkspaceRecord(
      { ...input(), newMembers: [address(1), address(2), address(4)] },
      "LOCAL",
      address(20),
    );
    expect(restoreWorkspace(JSON.parse(JSON.stringify(legacy))).M1).toEqual(
      legacy.M1,
    );
  });
});
