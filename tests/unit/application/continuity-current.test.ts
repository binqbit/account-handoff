import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountingLedger,
  CanonicalRecord,
  ContinuityCertificate,
} from "@account-handoff/contracts";
import type { GrantHistory } from "@account-handoff/grant-adapter";
import type {
  NativeAccountState,
  NativeFingerprint,
} from "@account-handoff/native-adapter";
import { Application } from "../../../apps/web/src/application/application";
import { assessCurrentContinuity } from "../../../apps/web/src/application/continuity";
import type {
  ChainView,
  WorkspaceRecord,
} from "../../../apps/web/src/application/models";
import type { Journal } from "@account-handoff/local-store";
import { sealRecord } from "@account-handoff/contracts";
import { readGrant, scanGrantHistory } from "@account-handoff/grant-adapter";
import { buildWorkspaceCertificate } from "../../../apps/web/src/application/continuity";
import {
  account,
  anchor,
  DIGEST,
  evidence,
  HASH,
  M0,
  M1,
  participants,
  profile,
} from "../../fixtures/core";

vi.mock("../../../apps/web/src/application/continuity", async (original) => ({
  ...(await original<
    typeof import("../../../apps/web/src/application/continuity")
  >()),
  buildWorkspaceCertificate: vi.fn(),
}));
vi.mock("@account-handoff/grant-adapter", async (original) => ({
  ...(await original<typeof import("@account-handoff/grant-adapter")>()),
  readGrant: vi.fn(),
  scanGrantHistory: vi.fn(),
}));

async function fixture() {
  const p = await sealRecord({
    ...(await profile()),
    status: "accepted" as const,
    genesis: HASH,
    metadataSha256: DIGEST,
    runtimeCodeHash: HASH,
  });
  const pure = account(20) as `0x${string}`;
  const hP = `0x${"20".repeat(20)}` as const;
  const state: NativeAccountState = {
    address: pure,
    free: 1000n,
    reserved: 5n,
    frozen: 100n,
    nonce: 0,
    proxies: [
      { delegate: M1.account as `0x${string}`, proxyType: "Any", delay: 0 },
    ],
    proxyDeposit: 10n,
    mappedAddress: hP,
    mappedTo: pure,
    holds: [{ id: "AddressMapping", amount: "5" }],
    namedReserves: [],
    vesting: [{ locked: "100", perBlock: "1", startingBlock: "10" }],
  };
  const grant: NonNullable<ChainView["grant"]> = {
    funder: `0x${"30".repeat(20)}`,
    grantee: hP,
    threshold: 2,
    milestoneCount: 2,
    token: `0x${"00".repeat(20)}`,
    milestones: [2, 1].map((status) => ({
      state: status,
      amount: 100n,
      deadline: 500n,
      vestingBlocks: status === 2 ? 100 : 0,
      approvals: 2,
      round: 0,
      metricTarget: `0x${"00".repeat(20)}`,
      metricSelector: "0x00000000",
      metricMin: 0n,
    })),
  };
  const workspace: WorkspaceRecord = {
    id: "reuse-test",
    name: "Synthetic previously verified proof",
    createdAt: "test",
    mode: "LOCAL",
    genesis: HASH as `0x${string}`,
    M0,
    M1,
    participants,
    pure,
    contract: `0x${"40".repeat(20)}`,
    grantId: "0",
    creationBlock: 1,
    creationEvidence: [evidence],
    history: [],
    baseline: {
      account: {
        ...state,
        proxies: [
          { delegate: M0.account as `0x${string}`, proxyType: "Any", delay: 0 },
        ],
      },
      grant,
      blockHash: HASH as `0x${string}`,
      creatorReserved: "10",
    },
  };
  const proofAnchor = anchor();
  proofAnchor.blockNumber = "30";
  proofAnchor.blockHash = `0x${"88".repeat(32)}`;
  // This is the view/coordinator boundary: independent chain reconstruction is tested elsewhere.
  const certificate = {
    kind: "ContinuityCertificate",
    schemaVersion: "2",
    recordId: "verified-certificate",
    digest: DIGEST,
    profileId: p.profileId,
    profileDigest: p.digest,
    verdict: "verified",
    before: anchor(),
    after: proofAnchor,
    M0,
    M1,
    removalReceiptId: "remove",
    milestone1SubmissionReceiptId: "continue",
    identity: {
      P: pure,
      hP,
      grantee: hP,
      contractAddress: workspace.contract,
      grantId: "0",
      milestone0Tuple: {
        locked: "100",
        perBlock: "1",
        startingBlock: "10",
        clockDomain: "native-block-number",
      },
      tupleMultiplicity: "1",
    },
  } as ContinuityCertificate;
  workspace.continuityCertificate = certificate;
  const fingerprint = {
    genesis: HASH,
    metadataSha256: DIGEST,
    runtimeCodeHash: HASH,
    anchor: { hash: HASH, number: 40 },
  } as NativeFingerprint;
  const chain: ChainView = {
    profile: p,
    fingerprint,
    accounts: { [pure]: state },
    grant,
    descriptor: null,
  };
  const currentAnchor = anchor();
  currentAnchor.blockNumber = "40";
  const accounting: AccountingLedger = {
    status: "reconciled",
    pure,
    creator: M0.account,
    anchor: currentAnchor,
    proxyDepositRecordedNative: "10",
    creatorHistoricalDepositNative: "10",
    creatorCurrentAggregateReservedNative: "10",
    pureProxyIncrementNative: "0",
    pureFreeNative: "1000",
    pureReservedNative: "5",
    pureFrozenNative: "100",
    pureReasonHolds: [
      { reason: "AddressMapping", amountNative: "5", evidence: [evidence] },
    ],
    pureNamedReserves: [],
    pureOtherTracedReservedLiabilitiesNative: "0",
    pureBackedLiabilitiesNative: "5",
    unexplainedReservedDeltaNative: "0",
    constantSetDigest: DIGEST,
    creationProvenance: [evidence],
    adjustmentProvenance: [],
    creatorDepositAutomaticallyRefunded: false,
    totalBalanceOnHoldAddedAgain: false,
  };
  const history = {
    complete: true,
    toBlock: 40,
    scannedThrough: 40,
    scope: "EligibleSingleRound",
  } as GrantHistory;
  return { workspace, chain, accounting, history, certificate, state };
}

describe("immutable certificate reuse and current continuity", () => {
  it("reports expired original vesting without altering the historical certificate", async () => {
    const input = await fixture();
    expect(assessCurrentContinuity(input).status).toBe("matched");
    const original = JSON.stringify(input.certificate);
    input.chain.fingerprint.anchor.number = 110;
    input.history.toBlock = input.history.scannedThrough = 110;
    expect(assessCurrentContinuity(input)).toMatchObject({
      status: "drift",
      reasons: expect.arrayContaining([
        expect.stringContaining("no longer active"),
      ]),
    });
    expect(JSON.stringify(input.certificate)).toBe(original);
  });
  it("reports reserve divergence and unavailable history independently of retained proof", async () => {
    const input = await fixture();
    input.accounting.creatorCurrentAggregateReservedNative = "0";
    expect(assessCurrentContinuity(input).status).toBe("drift");
    input.accounting.creatorCurrentAggregateReservedNative = "10";
    input.accounting.unexplainedReservedDeltaNative = "1";
    expect(assessCurrentContinuity(input).status).toBe("drift");
    input.accounting.unexplainedReservedDeltaNative = "0";
    input.history.complete = false;
    expect(assessCurrentContinuity(input).status).toBe("unavailable");
    expect(input.workspace.continuityCertificate).toBe(input.certificate);
  });
  it("refreshes current assessment without adding immutable records after verified session admission", async () => {
    const input = await fixture();
    const app = await Application.create();
    interface Access {
      workspaces: WorkspaceRecord[];
      currentId: string;
      chain: ChainView;
      grantHistory: GrantHistory;
      connection: object;
      journal: Partial<Journal>;
      metadata: Journal;
      accounting: ReturnType<typeof vi.fn>;
      updateCertificate(): Promise<void>;
    }
    const access = app as unknown as Access;
    const records = [
      input.certificate,
      {
        kind: "ReceiptBundle",
        recordId: "remove",
        operationId: "GRC-ROTATION-REMOVE-M0",
        profileDigest: input.certificate.profileDigest,
        businessEffect: "historically_verified",
      },
      {
        kind: "ReceiptBundle",
        recordId: "continue",
        operationId: "GRC-GRANT-SUBMIT-M1",
        profileDigest: input.certificate.profileDigest,
        businessEffect: "historically_verified",
      },
    ] as CanonicalRecord[];
    const appendRecord = vi.fn();
    access.workspaces = [input.workspace];
    access.currentId = input.workspace.id;
    access.chain = input.chain;
    access.grantHistory = input.history;
    access.connection = {};
    access.journal = {
      listRecords: vi.fn().mockResolvedValue(records),
      appendRecord,
    };
    access.accounting = vi.fn().mockResolvedValue(input.accounting);
    try {
      for (const height of [40, 41, 42, 110]) {
        input.chain.fingerprint.anchor.number = height;
        input.history.toBlock = input.history.scannedThrough = height;
        await access.updateCertificate();
      }
      expect(appendRecord).not.toHaveBeenCalled();
      expect(input.chain.currentContinuity?.status).toBe("drift");
      expect(input.workspace.continuityCertificate).toBe(input.certificate);
      expect(input.certificate.after.blockNumber).toBe("30");
    } finally {
      access.metadata.close();
    }
  });
  it("independently reconstructs the old anchor once after reload and then reuses its existing records", async () => {
    const input = await fixture();
    input.workspace.continuityCertificate = null; // Same mandatory boundary as restoreWorkspace.
    const certificate = await sealRecord(input.certificate);
    const records = [
      certificate,
      {
        kind: "ReceiptBundle",
        recordId: "remove",
        operationId: "GRC-ROTATION-REMOVE-M0",
        profileDigest: certificate.profileDigest,
        businessEffect: "historically_verified",
      },
      {
        kind: "ReceiptBundle",
        recordId: "continue",
        operationId: "GRC-GRANT-SUBMIT-M1",
        profileDigest: certificate.profileDigest,
        businessEffect: "historically_verified",
      },
    ] as CanonicalRecord[];
    const app = await Application.create();
    const access = app as unknown as {
      workspaces: WorkspaceRecord[];
      currentId: string;
      chain: ChainView;
      grantHistory: GrantHistory;
      metadata: Journal;
      journal: Partial<Journal>;
      connection: object;
      accounting: ReturnType<typeof vi.fn>;
      updateCertificate(): Promise<void>;
    };
    const appendRecord = vi.fn();
    const fingerprint = vi.fn(async (hash: string) => ({
      ...input.chain.fingerprint,
      anchor: { hash, number: hash === certificate.after.blockHash ? 30 : 10 },
    }));
    const reconstructed = {
      ...certificate,
      recordId: "fresh-reconstruction-id",
      digest: "new-digest",
    };
    vi.mocked(buildWorkspaceCertificate)
      .mockReset()
      .mockResolvedValue({
        certificate: reconstructed,
        beforeSnapshot: {} as never,
        afterSnapshot: {} as never,
      });
    vi.mocked(readGrant).mockResolvedValue(input.chain.grant!);
    vi.mocked(scanGrantHistory).mockResolvedValue({
      ...input.history,
      toBlock: 30,
      scannedThrough: 30,
    });
    access.workspaces = [input.workspace];
    access.currentId = input.workspace.id;
    access.chain = input.chain;
    access.grantHistory = input.history;
    access.connection = {
      fingerprint,
      readAccount: vi.fn().mockResolvedValue(input.state),
    };
    access.journal = {
      listRecords: vi.fn().mockResolvedValue(records),
      appendRecord,
    };
    access.accounting = vi.fn().mockResolvedValue(input.accounting);
    try {
      expect(input.workspace.continuityCertificate).toBeNull();
      await access.updateCertificate();
      expect(buildWorkspaceCertificate).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(buildWorkspaceCertificate).mock.calls[0]?.[0].afterFingerprint
          .anchor.number,
      ).toBe(30);
      expect(input.workspace.continuityCertificate).toEqual(certificate);
      await access.updateCertificate();
      expect(buildWorkspaceCertificate).toHaveBeenCalledTimes(1);
      expect(appendRecord).not.toHaveBeenCalled();
    } finally {
      await access.metadata.setPreference("workspaces", []);
      await access.metadata.setPreference("currentId", null);
      access.metadata.close();
    }
  });
});
