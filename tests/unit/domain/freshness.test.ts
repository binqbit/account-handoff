import { describe, expect, it } from "vitest";
import {
  validateFreshOperation,
  type FreshOperationInput,
} from "@account-handoff/domain";
import {
  envelope,
  profile,
  snapshot,
  M0,
  M1,
  participants,
  account,
} from "../../fixtures/core.js";
import type { FrozenEnvelope } from "@account-handoff/contracts";

async function base(): Promise<FreshOperationInput> {
  const p = await profile(),
    e = await envelope(p, await snapshot(p));
  return {
    envelope: e,
    signer: participants.S,
    phase: "direct",
    profileDigest: p.digest,
    timeUnixSeconds: 500n,
    authorityTuples: null,
    accounts: {
      [participants.S]: {
        free: 100n,
        reserved: 0n,
        frozen: 0n,
        mappedTo: null,
      },
    },
    grant: null,
    grantScope: "Unverified",
    grantHistoryComplete: false,
    proposal: null,
    pure: null,
    mappedPure: null,
    M0: M0.account,
    M1: M1.account,
    existentialDepositNative: 1n,
  };
}

function rotation(input: FreshOperationInput): FreshOperationInput {
  const e = structuredClone(input.envelope);
  e.intent.operationId = "GRC-ROTATION-REMOVE-M0";
  e.intent.parameters = {
    pure: account(20),
    oldController: M0.account,
    newController: M1.account,
    proxyType: "Any",
    delay: "0",
  };
  e.signingPath = "multisig_proxy";
  e.requiredSigners = [participants.A, participants.D];
  e.controller = M1;
  e.resources.valueNative = "0";
  e.innerRuntimeCallHash = `0x${"12".repeat(32)}`;
  return {
    ...input,
    envelope: e,
    signer: participants.D,
    phase: "multisig_final",
    pure: account(20),
    mappedPure: `0x${"12".repeat(20)}`,
    authorityTuples: [
      { delegate: M0.account, proxyType: "Any", delay: 0 },
      { delegate: M1.account, proxyType: "Any", delay: 0 },
    ],
    proposal: {
      depositor: participants.A,
      approvals: [participants.A],
      when: { height: 10, index: 1 },
    },
    expectedProposalTimepoint: { height: 10, index: 1 },
  };
}

describe("fresh operation preconditions", () => {
  it("permits rotation after grant completion without claiming a new continuity proof", async () => {
    const input = rotation(await base());
    input.baselineVesting = [];
    input.currentVesting = [];
    input.vestingBlockNumber = 100n;
    input.grantScope = "Closed";
    input.grantHistoryComplete = true;
    const milestone = {
      state: 2,
      round: 0,
      deadline: 1n,
      vestingBlocks: 0,
      metricTarget: `0x${"00".repeat(20)}`,
      metricSelector: "0x00000000",
      metricMin: 0n,
    };
    input.grant = {
      grantee: input.mappedPure!,
      funder: participants.F,
      threshold: 2,
      milestoneCount: 2,
      token: `0x${"00".repeat(20)}`,
      milestones: [milestone, milestone],
    };
    const codes = validateFreshOperation(input).map((value) => value.code);
    expect(codes).not.toContain("GrantScopeUnavailable");
    expect(codes).not.toContain("VestingContinuityUnknown");
    expect(codes).not.toContain("BaselineVestingMissing");
    expect(codes).not.toContain("ContinuationUnavailable");
    expect(codes).toContain("AccountingUnreconciled");
    input.envelope.intent.operationId = "GRC-GRANT-SUBMIT-M1";
    const continuation = validateFreshOperation(input).map(
      (value) => value.code,
    );
    expect(continuation).toContain("GrantScopeUnavailable");
    expect(continuation).toContain("BaselineVestingMissing");
  });
  it("allows a matured preserved schedule without dropping continuity guards", async () => {
    const input = rotation(await base());
    input.envelope.intent.operationId = "GRC-GRANT-SUBMIT-M1";
    const tuple = {
      locked: "100",
      perBlock: "1",
      startingBlock: "10",
      clockDomain: "native-block-number" as const,
    };
    input.baselineVesting = [tuple];
    input.currentVesting = [{ ...tuple }];
    input.vestingBlockNumber = 110n;
    let codes = validateFreshOperation(input).map((b) => b.code);
    expect(codes).not.toContain("BaselineVestingMissing");
    expect(codes).not.toContain("VestingContinuityUnknown");
    expect(codes).toContain("AccountingUnreconciled");
    input.currentVesting = [{ ...tuple, locked: "101" }];
    codes = validateFreshOperation(input).map((b) => b.code);
    expect(codes).toContain("VestingContinuityUnknown");
    delete input.vestingBlockNumber;
    expect(validateFreshOperation(input).map((b) => b.code)).toContain(
      "VestingClockUnavailable",
    );
  });
  it("requires exact current profile, review deadline and payer liquidity", async () => {
    const input = await base();
    expect(validateFreshOperation(input)).toEqual([]);
    expect(
      validateFreshOperation({ ...input, profileDigest: "00".repeat(32) }).some(
        (b) => b.code === "ProfileChanged",
      ),
    ).toBe(true);
    expect(
      validateFreshOperation({ ...input, timeUnixSeconds: 1001n }).some(
        (b) => b.code === "ReviewExpired",
      ),
    ).toBe(true);
    input.accounts = {
      [participants.S]: { free: 10n, frozen: 0n, reserved: 0n, mappedTo: null },
    };
    expect(
      validateFreshOperation(input).some(
        (b) => b.code === "InsufficientLiquidity",
      ),
    ).toBe(true);
  });
  it("does not filter out unsupported authority before exact-inventory checks", async () => {
    const input = rotation(await base());
    input.authorityTuples = [
      ...input.authorityTuples!,
      { delegate: account(30), proxyType: "Governance", delay: 3 },
    ];
    expect(
      validateFreshOperation(input).some((b) => b.code === "AuthorityChanged"),
    ).toBe(true);
  });
  it("rejects a final proposal whose first signer, depositor or incarnation changed", async () => {
    const input = rotation(await base());
    input.proposal = {
      depositor: participants.B,
      approvals: [participants.B],
      when: { height: 10, index: 2 },
    };
    const codes = validateFreshOperation(input).map((b) => b.code);
    expect(codes).toContain("FirstApprovalMismatch");
    expect(codes).toContain("ProposalIncarnationChanged");
  });
  it("does not admit an incomplete mapping/accounting/vesting/grant proof", async () => {
    const input = rotation(await base());
    const codes = validateFreshOperation(input).map((b) => b.code);
    expect(codes).toContain("MappingUnavailable");
    expect(codes).toContain("AccountingUnreconciled");
    expect(codes).toContain("VestingContinuityUnknown");
    expect(codes).toContain("GrantScopeUnavailable");
  });
  it("preserves native-only funding before mapping and blocks optional refresh before proof", async () => {
    const input = await base();
    expect(validateFreshOperation(input)).toEqual([]);
    const e: FrozenEnvelope = {
      ...input.envelope,
      intent: {
        ...input.envelope.intent,
        operationId: "GRC-VESTING-VEST-OTHER",
      },
    };
    expect(
      validateFreshOperation({ ...input, envelope: e }).some(
        (b) => b.code === "ContinuityProofRequired",
      ),
    ).toBe(true);
  });
  it("admits source-verified matured maintenance without granting an active-vesting certificate", async () => {
    const input = await base();
    input.envelope.intent.operationId = "GRC-VESTING-VEST-OTHER";
    input.continuityVerified = false;
    input.maturedVestingVerified = true;
    const tuple = {
      locked: "10",
      perBlock: "1",
      startingBlock: "100",
      clockDomain: "native-block-number",
    };
    input.baselineVesting = [tuple];
    input.currentVesting = [tuple];
    input.vestingBlockNumber = 110n;
    expect(validateFreshOperation(input).map((b) => b.code)).not.toContain(
      "ContinuityProofRequired",
    );
    input.vestingBlockNumber = 109n;
    expect(validateFreshOperation(input).map((b) => b.code)).toContain(
      "ContinuityProofRequired",
    );
    input.vestingBlockNumber = 110n;
    input.maturedVestingVerified = false;
    expect(validateFreshOperation(input).map((b) => b.code)).toContain(
      "ContinuityProofRequired",
    );
  });
});
