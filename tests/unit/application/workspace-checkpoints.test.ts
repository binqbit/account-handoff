import { describe, expect, it, vi } from "vitest";
import type {
  NativeAccountState,
  NativeConnection,
  NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { GrantState } from "@account-handoff/grant-adapter";
import { createWorkspaceRecord } from "../../../apps/web/src/application/workspace-state";
import { describeWorkspace } from "../../../apps/web/src/application/workspace-package";
import { restoreCheckpointHints } from "../../../apps/web/src/application/workspace-import";
import { account, DIGEST, HASH } from "../../fixtures/core";

const h = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const FIRST = h("1"),
  HANDOFF = h("2"),
  CURRENT = h("3");
const grantRead = vi.hoisted(() => vi.fn());
vi.mock("@account-handoff/grant-adapter", async (original) => ({
  ...(await original<typeof import("@account-handoff/grant-adapter")>()),
  readGrant: grantRead,
}));
function setup() {
  const w = createWorkspaceRecord(
    {
      name: "Checkpoint recovery",
      oldMembers: [account(1), account(2), account(3)],
      newMembers: [account(1), account(2), account(4)],
      threshold: 2,
      funder: account(5),
      reviewers: [account(6), account(7)],
      beneficiary: account(8),
      contract: `0x${"9".repeat(40)}`,
      grantId: "0",
    },
    "DEMO",
    HASH as `0x${string}`,
  );
  w.creationBlock = 1;
  w.creationEvidence = [
    {
      kind: "native_chain",
      locator: `${h("4")}/0`,
      sourceId: h("5"),
      contentSha256: DIGEST,
    },
  ];
  const state: NativeAccountState = {
    address: account(8) as `0x${string}`,
    free: 100n,
    reserved: 10n,
    frozen: 50n,
    nonce: 0,
    proxies: [
      { delegate: w.M0.account as `0x${string}`, proxyType: "Any", delay: 0 },
    ],
    proxyDeposit: 10n,
    mappedAddress: `0x${"8".repeat(40)}`,
    mappedTo: account(8) as `0x${string}`,
    holds: [],
    vesting: [{ locked: 100n, perBlock: 2n, startingBlock: 9n }],
  };
  const grant = {
    grantee: state.mappedAddress,
    milestones: [{ state: 2 }],
  } as unknown as GrantState;
  w.baseline = {
    account: structuredClone(state),
    grant,
    blockHash: FIRST,
    creatorReserved: "10",
  };
  const d = describeWorkspace(w);
  d.handoffBaselineBlockHash = HANDOFF;
  const fingerprint = vi.fn(
    async (hash: string) =>
      ({
        genesis: HASH,
        anchor: {
          hash,
          number: hash === FIRST ? 10 : hash === HANDOFF ? 20 : 30,
        },
      }) as NativeFingerprint,
  );
  const canonical = vi.fn(async (number: number) =>
    number === 10 ? FIRST : number === 20 ? HANDOFF : CURRENT,
  );
  const readAccount = vi.fn(async () => structuredClone(state));
  grantRead.mockReset().mockResolvedValue(grant);
  const connection = {
    fingerprint,
    readAccount,
    api: { rpc: { chain_getBlockHash: canonical } },
  } as unknown as NativeConnection;
  const current = {
    genesis: HASH,
    anchor: { hash: CURRENT, number: 30 },
  } as NativeFingerprint;
  return {
    w,
    d,
    state,
    fingerprint,
    canonical,
    readAccount,
    connection,
    current,
  };
}
describe("restored checkpoint semantics", () => {
  it("reconstructs the handoff state from canonical chain reads while keeping the verified original release", async () => {
    const f = setup();
    await restoreCheckpointHints(f.w, f.d, f.connection, f.current);
    expect(f.w.baseline?.blockHash).toBe(FIRST);
    expect(f.w.handoffBaseline).toMatchObject({
      blockHash: HANDOFF,
      creatorReserved: "10",
      account: { free: 100n },
    });
    expect(f.readAccount).toHaveBeenCalledWith(f.w.pure, HANDOFF);
    expect(grantRead).toHaveBeenCalledWith(
      f.connection,
      f.w.pure,
      f.w.contract,
      0n,
      HANDOFF,
    );
  });
  it("rejects another canonical block presented as the original vesting release before making a checkpoint read", async () => {
    const f = setup();
    f.d.baselineBlockHash = HANDOFF;
    await expect(
      restoreCheckpointHints(f.w, f.d, f.connection, f.current),
    ).rejects.toThrow("verified first release");
    expect(f.readAccount).not.toHaveBeenCalled();
    expect(f.w.handoffBaseline).toBeUndefined();
  });
  it.each(["foreign", "delayed", "extra", "lost-schedule"])(
    "rejects a handoff checkpoint with %s state",
    async (change) => {
      const f = setup();
      if (change === "foreign") f.state.proxies[0]!.delegate = h("7");
      if (change === "delayed") f.state.proxies[0]!.delay = 1;
      if (change === "extra")
        f.state.proxies.push({ delegate: h("7"), proxyType: "Any", delay: 0 });
      if (change === "lost-schedule") f.state.vesting = [];
      await expect(
        restoreCheckpointHints(f.w, f.d, f.connection, f.current),
      ).rejects.toThrow("original grant schedule");
      expect(f.w.handoffBaseline).toBeUndefined();
    },
  );
  it.each(["future", "noncanonical", "before-creation"])(
    "rejects %s historical anchors",
    async (change) => {
      const f = setup();
      if (change === "future") f.current.anchor.number = 15;
      if (change === "noncanonical") f.canonical.mockResolvedValue(h("f"));
      if (change === "before-creation") f.w.creationBlock = 21;
      await expect(
        restoreCheckpointHints(f.w, f.d, f.connection, f.current),
      ).rejects.toThrow("canonical finalized block");
      expect(f.w.handoffBaseline).toBeUndefined();
    },
  );
  it("requires a real planned handoff and a separately discovered original vesting release", async () => {
    const f = setup();
    f.w.M1 = null;
    await expect(
      restoreCheckpointHints(f.w, f.d, f.connection, f.current),
    ).rejects.toThrow("planned replacement");
    const g = setup();
    g.w.baseline = null;
    await expect(
      restoreCheckpointHints(g.w, g.d, g.connection, g.current),
    ).rejects.toThrow("verified first release");
  });
});
