import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Journal } from "@account-handoff/local-store";
import type { NativeConnection } from "@account-handoff/native-adapter";
import { Application } from "../../../apps/web/src/application/application";
import type { AppSnapshot } from "../../../apps/web/src/ui-contract";
import { createWorkspaceRecord } from "../../../apps/web/src/application/workspace-state";
import type {
  ChainView,
  WorkspaceRecord,
} from "../../../apps/web/src/application/models";
import { account, HASH, profile } from "../../fixtures/core";

const journals: Journal[] = [];
afterEach(() => journals.splice(0).forEach((journal) => journal.close()));

describe("failed finalized-state refresh", () => {
  it("does not expose the previous workspace's grant while a new read is pending or failed", async () => {
    const app = await Application.create();
    const access = app as unknown as {
      metadata: Journal;
      state: AppSnapshot;
      journal: Journal | null;
      workspaces: WorkspaceRecord[];
      currentId: string;
      chain: ChainView | null;
      grantHistory: unknown;
      connection: Pick<NativeConnection, "fingerprint">;
      descriptor(): Promise<null>;
    };
    journals.push(access.metadata);
    const input = {
      name: "First workspace",
      oldMembers: [account(1), account(2), account(3)],
      threshold: 2,
      funder: account(4),
      reviewers: [account(5), account(6)],
      beneficiary: account(7),
      contract: `0x${"ab".repeat(20)}`,
      grantId: "0",
    };
    const first = createWorkspaceRecord(input, "LOCAL", HASH as `0x${string}`);
    const second = createWorkspaceRecord(
      {
        ...input,
        name: "Second workspace",
        beneficiary: account(8),
        grantId: "1",
      },
      "LOCAL",
      HASH as `0x${string}`,
    );
    access.workspaces = [first, second];
    access.currentId = first.id;
    const previousJournal = { close: vi.fn() } as unknown as Journal;
    access.journal = previousJournal;
    access.chain = {
      fingerprint: {
        genesis: HASH,
        tokenDecimals: 14,
        tokenSymbol: "UNIT",
        anchor: { hash: HASH, number: 10 },
      } as ChainView["fingerprint"],
      accounts: {},
      profile: await profile(),
      descriptor: null,
      grant: {
        funder: `0x${"01".repeat(20)}`,
        grantee: `0x${"02".repeat(20)}`,
        threshold: 2,
        milestoneCount: 1,
        token: `0x${"00".repeat(20)}`,
        milestones: [
          {
            amount: 1n,
            deadline: 1_900_000_000n,
            vestingBlocks: 0,
            approvals: 0,
            round: 0,
            state: 0,
            metricTarget: `0x${"00".repeat(20)}`,
            metricSelector: "0x00000000",
            metricMin: 0n,
          },
        ],
      },
    };
    access.grantHistory = { complete: true };
    access.state = {
      ...app.getSnapshot(),
      network: {
        ...app.getSnapshot().network,
        connected: true,
        historyProgress: { completed: 10, total: 20 },
        readiness: [
          {
            id: "native",
            label: "Native RPC",
            status: "ready",
            detail: "Read",
          },
          {
            id: "profile",
            label: "Runtime profile",
            status: "ready",
            detail: "Qualified",
          },
        ],
      },
    };
    let failRead!: (error: Error) => void;
    access.connection = {
      fingerprint: vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            failRead = reject;
          }),
      ),
    };
    access.descriptor = vi.fn().mockResolvedValue(null);

    const switching = app.dispatch({ type: "select-workspace", id: second.id });
    await vi.waitFor(() =>
      expect(app.getSnapshot().workspace?.id).toBe(second.id),
    );
    try {
      expect(access.chain).toBeNull();
      expect(access.grantHistory).toBeNull();
      expect(access.journal).toBeNull();
      expect(previousJournal.close).toHaveBeenCalledOnce();
      expect(app.getSnapshot().workspace?.milestones).toEqual([]);
    } finally {
      failRead(new Error("Finalized RPC unavailable"));
      await expect(switching).rejects.toThrow("Finalized RPC unavailable");
    }

    expect(access.chain).toBeNull();
    expect(access.grantHistory).toBeNull();
    expect(app.getSnapshot().network.connected).toBe(false);
    expect(app.getSnapshot().network.historyProgress).toBeNull();
    expect(
      app
        .getSnapshot()
        .network.readiness.every((item) => item.status === "unknown"),
    ).toBe(true);
    expect(app.getSnapshot().workspace).toMatchObject({
      id: second.id,
      milestones: [],
      authority: "Unknown",
      currentTask: { destination: "network" },
    });
    expect(app.getSnapshot().actions.every((action) => !action.enabled)).toBe(
      true,
    );
    await expect(app.dispatch({ type: "export-package" })).rejects.toThrow(
      "Open a workspace",
    );
  });
});
