import { describe, expect, it } from "vitest";
import {
  OPERATION_IDS,
  planOperation,
  validateIntent,
  type PlanContext,
} from "@account-handoff/domain";
import type { DataValue, Intent } from "@account-handoff/contracts";
import {
  M0,
  M1,
  account,
  envelope,
  evidence,
  participants,
  profile,
  snapshot,
  HASH,
} from "../../fixtures/core.js";

const contract = `0x${"ab".repeat(20)}`;
const pure = account(12);
const mapped = `0x${"bc".repeat(20)}`;
const amounts: Record<string, DataValue> = {
  "GRC-SETUP-FUND-M0": { recipient: M0.account, valueNative: "10" },
  "GRC-SETUP-FUND-ACTOR": {
    recipientRole: "D",
    recipient: participants.D,
    valueNative: "10",
  },
  "GRC-SETUP-CREATE-PURE": { pureIndex: "0", proxyType: "Any", delay: "0" },
  "GRC-SETUP-FUND-P": { pure, valueNative: "10" },
  "GRC-SETUP-MAP-P": { pure },
  "GRC-SETUP-MAP-ACTOR": { actorRole: "F", account: participants.F },
  "GRC-GRANT-CREATE": {
    contract,
    granteeH160: mapped,
    token: `0x${"00".repeat(20)}`,
    reviewers: [`0x${"01".repeat(20)}`, `0x${"02".repeat(20)}`],
    threshold: "2",
    milestones: [
      {
        amount: "180000",
        deadline: "1000",
        vestingBlocks: "1800",
        metricTarget: `0x${"00".repeat(20)}`,
        metricSelector: "0x00000000",
        metricMin: "0",
      },
      {
        amount: "120000",
        deadline: "2000",
        vestingBlocks: "0",
        metricTarget: `0x${"00".repeat(20)}`,
        metricSelector: "0x00000000",
        metricMin: "0",
      },
    ],
  },
  "GRC-GRANT-SUBMIT-M0": {
    contract,
    grantId: "0",
    index: "0",
    evidence: "Initial milestone",
  },
  "GRC-GRANT-SUBMIT-M1": {
    contract,
    grantId: "0",
    index: "1",
    evidence: "Continued milestone",
  },
  "GRC-GRANT-APPROVE": { contract, grantId: "0", index: "0" },
  "GRC-ROTATION-ADD-M1": {
    pure,
    oldController: M0.account,
    newController: M1.account,
    proxyType: "Any",
    delay: "0",
  },
  "GRC-ROTATION-REMOVE-M0": {
    pure,
    oldController: M0.account,
    newController: M1.account,
    proxyType: "Any",
    delay: "0",
  },
  "GRC-VESTING-VEST-OTHER": { targetPure: pure },
  "GRC-MULTISIG-CANCEL": {
    targetController: M0,
    targetCallHash: HASH,
    targetTimepoint: { height: "1", index: "0", clockDomain: "system" },
    originalDepositor: participants.A,
    targetEnvelopeDigest: null,
    originalTargetCallBytes: null,
  },
};

async function base() {
  const p = await profile();
  return envelope(p, await snapshot(p));
}
function context(value = "0"): PlanContext {
  return {
    participants,
    M0,
    M1,
    pure,
    mappedPure: mapped,
    nativeToAbiRatio: 10000n,
    sourceEvidence: [evidence],
    encodeAbi: () => "0x00",
    resources: {
      valueNative: value,
      reviveWeight: { refTime: "10000", proofSize: "1000" },
      storageDepositLimitNative: "100",
      multisigInnerMaxWeight: { refTime: "20000", proofSize: "2000" },
      outerFeeEstimateNative: "1",
      outerFeeLocalBudgetNative: "2",
      feeBudgetIsChainEnforcedCap: false,
      estimationEvidence: [evidence],
    },
  };
}

describe("closed operation grammar", () => {
  it("creates the beneficiary before any replacement group is defined", async () => {
    const e = await base();
    const initial = {
      ...context(),
      M1: null,
      participants: { ...participants, D: null },
    };
    const plan = planOperation(
      {
        ...e.intent,
        operationId: "GRC-SETUP-CREATE-PURE",
        parameters: amounts["GRC-SETUP-CREATE-PURE"] as Intent["parameters"],
      },
      initial,
    );
    expect(plan.controller).toEqual(M0);
    expect(plan.requiredSigners).toEqual([participants.A, participants.B]);
    expect(() =>
      planOperation(
        {
          ...e.intent,
          operationId: "GRC-ROTATION-ADD-M1",
          parameters: amounts["GRC-ROTATION-ADD-M1"] as Intent["parameters"],
        },
        initial,
      ),
    ).toThrow("Plan the replacement");
  });
  it("provides all fourteen selected intents with the intended signer paths", async () => {
    const e = await base();
    for (const operationId of OPERATION_IDS) {
      const parameters = amounts[operationId] as Intent["parameters"];
      const intent: Intent = {
        ...e.intent,
        operationId,
        parameters,
        authorActor:
          operationId === "GRC-GRANT-APPROVE"
            ? participants.R1
            : e.intent.authorActor,
      };
      const value = operationId.startsWith("GRC-SETUP-FUND")
        ? "10"
        : operationId === "GRC-GRANT-CREATE"
          ? "30"
          : "0";
      const plan = planOperation(intent, context(value));
      expect(plan.callTree.kind, operationId).toBe("native_call");
      expect(plan.requiredSigners.length, operationId).toBeGreaterThan(0);
      if (
        operationId === "GRC-ROTATION-REMOVE-M0" ||
        operationId === "GRC-GRANT-SUBMIT-M1"
      )
        expect(plan.requiredSigners).toEqual([participants.A, participants.D]);
    }
  });
  it("SG-13: removes the exact original tuple and refuses a substituted controller", async () => {
    const e = await base();
    const intent: Intent = {
      ...e.intent,
      operationId: "GRC-ROTATION-REMOVE-M0",
      parameters: amounts["GRC-ROTATION-REMOVE-M0"] as Intent["parameters"],
    };
    const plan = planOperation(intent, context());
    expect(plan.signingPath).toBe("multisig_proxy");
    expect(plan.callTree.children[0]?.method).toBe("remove_proxy");
    expect(plan.callTree.children[0]?.parameters).toEqual({
      delegate: M0.account,
      proxyType: "Any",
      delay: "0",
    });
    expect(() =>
      planOperation(
        {
          ...intent,
          parameters: { ...intent.parameters, oldController: participants.A },
        },
        context(),
      ),
    ).toThrow(/Controller/);
  });
  it("refuses excluded operations and UTF-8 overflow even when character length is small", async () => {
    const e = await base();
    expect(
      validateIntent({ ...e.intent, operationId: "GRC-GRANT-RECLAIM" }).ok,
    ).toBe(false);
    const submission = {
      ...e.intent,
      operationId: "GRC-GRANT-SUBMIT-M1",
      parameters: {
        contract,
        grantId: "0",
        index: "1",
        evidence: "é".repeat(513),
      },
    };
    expect(validateIntent(submission).ok).toBe(false);
  });
});
