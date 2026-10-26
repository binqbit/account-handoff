import { beforeEach, describe, expect, it, vi } from "vitest";
import { readGrant, scanGrantHistory } from "@account-handoff/grant-adapter";
import { contractAddress } from "@account-handoff/native-adapter";
import { loadOperationInputs } from "../../../apps/web/src/application/operation-inputs";

vi.mock("@account-handoff/grant-adapter", () => ({
  readGrant: vi.fn(),
  scanGrantHistory: vi.fn(),
  isGrantReviewer: vi.fn(),
}));
vi.mock("../../../apps/web/src/application/presentation", () => ({
  workspaceView: () => ({ continuity: "rotated" }),
}));

const pure = `0x${"11".repeat(32)}`;
const hash = `0x${"22".repeat(32)}`;
const tuple = { locked: "100", perBlock: "1", startingBlock: 10 };
const release = {
  eventName: "MilestoneReleased",
  blockNumber: 10,
  blockHash: hash,
  args: { index: "0", amount: "1000000", vestingBlocks: "100" },
};

function fixture() {
  const account = { address: pure, mappedTo: pure, vesting: [tuple] };
  const context = {
    workspace: {
      participants: { S: pure },
      M0: { account: pure },
      M1: null,
      pure,
      contract: `0x${"33".repeat(20)}`,
      grantId: "0",
      creationBlock: 1,
      baseline: { blockHash: hash, account: { vesting: [tuple] } },
    },
    chain: { profile: { digest: "profile" } },
    connection: {
      readAccount: vi.fn().mockResolvedValue(account),
      currentBlockTime: vi.fn().mockResolvedValue(1000n),
      api: {
        consts: {
          balances: { existentialDeposit: 1n },
          multisig: { depositBase: 1n, depositFactor: 1n },
          proxy: { proxyDepositBase: 1n, proxyDepositFactor: 1n },
          revive: { depositPerItem: 1n, depositPerByte: 1n },
        },
      },
    },
    accounting: vi.fn().mockResolvedValue(undefined),
  };
  const pending = {
    actionId: "GRC-VESTING-VEST-OTHER",
    action: { kind: "vest-other" },
    signer: pure,
    phase: "direct",
    envelope: {
      controller: null,
      innerRuntimeCallHash: null,
      intent: { parameters: { targetPure: pure } },
    },
  };
  const fingerprint = { anchor: { hash, number: 110 } };
  return { context, pending, fingerprint, account };
}

describe("matured vesting maintenance admission", () => {
  beforeEach(() => {
    vi.mocked(readGrant).mockResolvedValue({
      grantee: contractAddress(pure),
    } as never);
    vi.mocked(scanGrantHistory).mockResolvedValue({
      complete: true,
      firstVestingRelease: release,
    } as never);
  });
  it("binds the completed schedule to this beneficiary and original grant release", async () => {
    const { context, pending, fingerprint } = fixture();
    const result = await loadOperationInputs(
      context as never,
      pending as never,
      fingerprint as never,
    );
    expect(result.continuityVerified).toBe(false);
    expect(result.maturedVestingVerified).toBe(true);
  });
  it.each(["history", "release", "recipient", "maturity", "schedule"])(
    "rejects altered %s evidence",
    async (caseName) => {
      const { context, pending, fingerprint, account } = fixture();
      if (caseName === "history")
        vi.mocked(scanGrantHistory).mockResolvedValue({
          complete: false,
          firstVestingRelease: release,
        } as never);
      if (caseName === "release")
        context.workspace.baseline.blockHash = `0x${"44".repeat(32)}`;
      if (caseName === "recipient")
        vi.mocked(readGrant).mockResolvedValue({
          grantee: `0x${"55".repeat(20)}`,
        } as never);
      if (caseName === "maturity") fingerprint.anchor.number = 109;
      if (caseName === "schedule")
        account.vesting = [{ ...tuple, locked: "101" }];
      const result = await loadOperationInputs(
        context as never,
        pending as never,
        fingerprint as never,
      );
      expect(result.maturedVestingVerified).toBe(false);
    },
  );
});
