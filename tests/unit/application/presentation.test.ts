import { describe, expect, it } from "vitest";
import type {
  ChainView,
  WorkspaceHistory,
  WorkspaceRecord,
} from "../../../apps/web/src/application/models";
import {
  actionViews,
  workspaceView,
} from "../../../apps/web/src/application/presentation";
const hex = (character: string, bytes = 32) =>
  `0x${character.repeat(bytes * 2)}` as `0x${string}`;
const [A, B, C, D, F, R1, R2, S, P, M0, M1] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "a",
  "b",
].map((value) => hex(value));
function fixture(): { workspace: WorkspaceRecord; chain: ChainView } {
  const workspace: WorkspaceRecord = {
    id: "workspace",
    name: "Example",
    createdAt: "2026-10-24T00:00:00Z",
    mode: "LOCAL",
    genesis: hex("c"),
    M0: { account: M0!, members: [A!, B!, C!], threshold: "2", role: "M0" },
    M1: { account: M1!, members: [A!, B!, D!], threshold: "2", role: "M1" },
    participants: {
      A: A!,
      B: B!,
      C: C!,
      D: D!,
      F: F!,
      R1: R1!,
      R2: R2!,
      S: S!,
    },
    pure: P!,
    contract: hex("d", 20),
    grantId: "0",
    creationEvidence: [],
    history: [],
    baseline: null,
  };
  const accounts = Object.fromEntries(
    [A!, B!, C!, D!, F!, R1!, R2!, S!, P!, M0!, M1!].map((address) => [
      address,
      {
        address,
        free: 1000000000000n,
        reserved: 0n,
        frozen: 100000000000n,
        nonce: 0,
        proxies:
          address === P ? [{ delegate: M0!, proxyType: "Any", delay: 0 }] : [],
        proxyDeposit: 0n,
        mappedAddress: hex("e", 20),
        mappedTo: address,
        holds: [],
        vesting: [],
      },
    ]),
  );
  const grant: NonNullable<ChainView["grant"]> = {
    funder: hex("f", 20),
    threshold: 2,
    milestoneCount: 2,
    grantee: hex("e", 20),
    token: hex("0", 20),
    milestones: [
      {
        amount: 180000000000000000n,
        deadline: 1900000000n,
        vestingBlocks: 1800,
        approvals: 2,
        round: 0,
        state: 2,
        metricTarget: hex("0", 20),
        metricSelector: "0x00000000",
        metricMin: 0n,
      },
      {
        amount: 120000000000000000n,
        deadline: 1900000000n,
        vestingBlocks: 0,
        approvals: 1,
        round: 0,
        state: 1,
        metricTarget: hex("0", 20),
        metricSelector: "0x00000000",
        metricMin: 0n,
      },
    ],
  };
  const chain: ChainView = {
    fingerprint: {
      genesis: hex("c"),
      specName: "test",
      specVersion: 1,
      transactionVersion: 1,
      metadataVersion: 15,
      metadataHash: hex("1"),
      metadataSha256: "1".repeat(64),
      rawMetadata: "0x00",
      runtimeCodeHash: hex("2"),
      signedExtensions: [],
      runtimeApis: {},
      anchor: { hash: hex("3"), number: 100 },
      tokenDecimals: 12,
      tokenSymbol: "UNIT",
      ss58Prefix: 42,
    },
    accounts,
    grant,
    profile: { status: "accepted" } as ChainView["profile"],
    localDescriptor: {
      mode: "LOCAL",
      runId: "test",
      generation: 1,
      status: "active",
      nativeRpc: "ws://localhost:9944",
      gatewayRpc: "ws://localhost:8545",
      namespace: "test",
      buildHash: null,
      runtime: {
        specName: "test",
        specVersion: 1,
        nativeDecimals: 12,
        nativeToEthRatio: "10000",
        autoMap: false,
      },
    },
  };
  return { workspace, chain };
}
function row(
  operationId: WorkspaceHistory["operationId"],
  block: number,
  grantId = "0",
): WorkspaceHistory {
  return {
    id: `${operationId}:${block}`,
    operationId,
    title: operationId,
    at: "2026-10-24T00:00:00Z",
    signer: D!,
    receipt: {
      txHash: hex("a"),
      blockHash: hex("b"),
      blockNumber: block,
      txIndex: 0,
      events: [],
      outerSuccess: true,
      nestedSuccess: true,
      businessExecuted: true,
      failure: null,
    },
    envelopeDigest: "d".repeat(64),
    attemptId: `attempt:${block}`,
    grantId,
  };
}
describe("UI presentation preserves authoritative distinctions", () => {
  it("keeps exactly fourteen actions and disables disconnected preparation", () => {
    const { workspace } = fixture();
    const actions = actionViews(workspace, null, null);
    expect(actions).toHaveLength(14);
    expect(new Set(actions.map((action) => action.id)).size).toBe(14);
    expect(
      actions.every((action) => !action.enabled && action.blockers.length >= 2),
    ).toBe(true);
  });
  it("shows actual approval count without inventing reviewer identities", () => {
    const { workspace, chain } = fixture();
    const view = workspaceView(workspace, chain);
    expect(view.milestones[1]?.approvalCount).toBe(1);
    expect(view.milestones[1]?.approvals).toBeNull();
    expect(
      view.balances.find((balance) => balance.identity.address === A)
        ?.available,
    ).toBe("0.9");
  });
  it("does not mistake an extra authority for a completed handoff", () => {
    const { workspace, chain } = fixture();
    chain.accounts[P!]!.proxies.push({
      delegate: hex("f"),
      proxyType: "Any",
      delay: 0,
    });
    expect(workspaceView(workspace, chain).authority).toBe("Diverged");
    expect(
      actionViews(workspace, chain, A!).find(
        (action) => action.id === "GRC-ROTATION-ADD-M1",
      )?.enabled,
    ).toBe(false);
  });
  it("requires baseline, distinct removal and later same-grant submission", () => {
    const { workspace, chain } = fixture();
    chain.accounts[P!]!.proxies = [
      { delegate: M1!, proxyType: "Any", delay: 0 },
    ];
    workspace.history = [
      row("GRC-GRANT-SUBMIT-M1", 30),
      row("GRC-ROTATION-REMOVE-M0", 20),
    ];
    expect(workspaceView(workspace, chain).continuity).toBe("not-started");
    workspace.baseline = {
      account: structuredClone(chain.accounts[P!]!),
      grant: structuredClone(chain.grant!),
      blockHash: hex("3"),
    };
    expect(workspaceView(workspace, chain).continuity).toBe("continued");
    workspace.history[0]!.grantId = "1";
    expect(workspaceView(workspace, chain).continuity).toBe("rotated");
    workspace.history[0]!.grantId = "0";
    workspace.history[0]!.receipt.blockNumber = 10;
    expect(workspaceView(workspace, chain).continuity).toBe("rotated");
  });
  it("preserves historical evidence while reporting current authority drift", () => {
    const { workspace, chain } = fixture();
    workspace.baseline = {
      account: structuredClone(chain.accounts[P!]!),
      grant: structuredClone(chain.grant!),
      blockHash: hex("3"),
    };
    workspace.history = [
      row("GRC-ROTATION-REMOVE-M0", 20),
      row("GRC-GRANT-SUBMIT-M1", 30),
    ];
    expect(workspaceView(workspace, chain).continuity).toBe("drift");
  });
  it("does not assume native/ABI conversion when its binding is absent", () => {
    const { workspace, chain } = fixture();
    chain.localDescriptor = null;
    const view = workspaceView(workspace, chain);
    expect(view.grantTotal).toBeNull();
    expect(view.milestones[0]?.amount).toContain("ABI units");
  });
  it("does not give a signer funder or reviewer controls by selecting a tab", () => {
    const { workspace, chain } = fixture();
    const actions = actionViews(workspace, chain, A!);
    expect(
      actions.find((action) => action.id === "GRC-GRANT-CREATE")?.enabled,
    ).toBe(false);
    expect(
      actions.find((action) => action.id === "GRC-GRANT-APPROVE")?.enabled,
    ).toBe(false);
    expect(
      actionViews(workspace, chain, R1!).find(
        (action) => action.id === "GRC-GRANT-APPROVE",
      )?.enabled,
    ).toBe(true);
  });
});
