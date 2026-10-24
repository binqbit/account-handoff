import { describe, expect, it } from "vitest";
import {
  operationResourceRequirements,
  validateFreshOperation,
} from "@account-handoff/domain";
import type { FreshOperationInput } from "@account-handoff/domain";
import { buildResourceReview } from "../../../apps/web/src/application/resources";
import {
  account,
  envelope,
  M0,
  M1,
  participants,
  profile,
  snapshot,
} from "../../fixtures/core";

const P = account(20);
const token = { decimals: 0, symbol: "UNIT" };
async function input(
  operation: FreshOperationInput["envelope"]["intent"]["operationId"],
  phase: FreshOperationInput["phase"] = "direct",
): Promise<FreshOperationInput> {
  const p = await profile(),
    e = await envelope(p, await snapshot(p));
  e.intent.operationId = operation;
  e.resources = {
    ...e.resources,
    valueNative: "0",
    outerFeeEstimateNative: "1",
    outerFeeLocalBudgetNative: "2",
  };
  if (phase.startsWith("multisig")) {
    e.signingPath = "multisig_direct";
    e.requiredSigners = [participants.A, participants.B];
    e.controller = M0;
  }
  const signer =
    phase === "multisig_first"
      ? participants.A
      : phase === "multisig_final"
        ? participants.B
        : participants.F;
  e.requiredSigners = phase === "direct" ? [signer] : e.requiredSigners;
  return {
    envelope: e,
    signer,
    phase,
    profileDigest: p.digest,
    timeUnixSeconds: 500n,
    pure: P,
    mappedPure: account(20),
    M0: M0.account,
    M1: M1.account,
    authorityTuples: [{ delegate: M0.account, proxyType: "Any", delay: 0 }],
    accounts: Object.fromEntries(
      [signer, P, M0.account].map((who) => [
        who,
        { free: 100n, reserved: 1000n, frozen: 2n, mappedTo: who },
      ]),
    ),
    grant: null,
    grantScope: "Unverified",
    grantHistoryComplete: false,
    proposal: null,
    existentialDepositNative: 1n,
    proposalDepositNative: 7n,
    pureCreationDepositNative: 13n,
    mappingDepositNative: 5n,
    proxyIncrementNative: 3n,
  };
}
const costs = (value: FreshOperationInput) =>
  buildResourceReview(value, token).map(({ kind, payer, amountNative }) => ({
    kind,
    payer,
    amountNative,
  }));

describe("review resource split shares the exact funding guard allocation", () => {
  it("shows separate first-approval and creator deposits with their distinct retention rules", async () => {
    const value = await input("GRC-SETUP-CREATE-PURE", "multisig_first");
    value.pure = null;
    expect(costs(value)).toEqual([
      { kind: "outer_fee", payer: participants.A, amountNative: "2" },
      { kind: "proposal_deposit", payer: participants.A, amountNative: "7" },
      { kind: "pure_deposit", payer: M0.account, amountNative: "13" },
    ]);
    const rows = buildResourceReview(value, token);
    expect(
      rows.find((row) => row.kind === "proposal_deposit")?.label,
    ).toContain("refunded to the depositor");
    expect(rows.find((row) => row.kind === "pure_deposit")?.label).toContain(
      "remains with M0",
    );
    expect(rows.find((row) => row.kind === "pure_deposit")?.label).toContain(
      "after the second signature",
    );
    value.phase = "multisig_final";
    value.signer = participants.B;
    expect(costs(value).map((row) => row.kind)).toEqual([
      "outer_fee",
      "pure_deposit",
    ]);
  });
  it("attributes mapping and additional proxy reserves to P, not the human fee payer", async () => {
    const mapping = await input("GRC-SETUP-MAP-P", "multisig_first");
    expect(costs(mapping).find((row) => row.kind === "mapping_hold")).toEqual({
      kind: "mapping_hold",
      payer: P,
      amountNative: "5",
    });
    const actor = await input("GRC-SETUP-MAP-ACTOR");
    expect(costs(actor).find((row) => row.kind === "mapping_hold")?.payer).toBe(
      participants.F,
    );
    const add = await input("GRC-ROTATION-ADD-M1", "multisig_final");
    expect(costs(add)).toEqual([
      { kind: "outer_fee", payer: participants.B, amountNative: "2" },
      { kind: "proxy_increment", payer: P, amountNative: "3" },
    ]);
  });
  it("counts the fee budget once and does not charge existing reserved or frozen balances again", async () => {
    const value = await input("GRC-GRANT-CREATE");
    value.envelope.resources.valueNative = "30";
    value.envelope.resources.storageDepositLimitNative = "9";
    value.accounts[participants.F]!.free = 43n;
    expect(costs(value)).toEqual([
      { kind: "outer_fee", payer: participants.F, amountNative: "2" },
      { kind: "value", payer: participants.F, amountNative: "30" },
      { kind: "storage_limit", payer: participants.F, amountNative: "9" },
    ]);
    expect(
      operationResourceRequirements(value).reduce(
        (sum, row) => sum + (row.amountNative ?? 0n),
        0n,
      ),
    ).toBe(41n);
    expect(
      validateFreshOperation(value).some(
        (blocker) => blocker.code === "InsufficientLiquidity",
      ),
    ).toBe(false);
    value.accounts[participants.F]!.free = 42n;
    expect(
      validateFreshOperation(value).some(
        (blocker) => blocker.code === "InsufficientLiquidity",
      ),
    ).toBe(true);
    const fee = buildResourceReview(value, token).find(
      (row) => row.kind === "outer_fee",
    )!;
    expect(fee.amount).toContain("2 UNIT (estimate 1 UNIT");
    expect(fee.source).toBe("reviewed_fee_budget");
  });
  it("uses P for submitted contract storage and preserves unknown requirements as unknown", async () => {
    const value = await input("GRC-GRANT-SUBMIT-M1", "multisig_final");
    value.envelope.resources.storageDepositLimitNative = "9";
    expect(costs(value).find((row) => row.kind === "storage_limit")).toEqual({
      kind: "storage_limit",
      payer: P,
      amountNative: "9",
    });
    value.envelope.resources.storageDepositLimitNative = null;
    const row = buildResourceReview(value, token).find(
      (item) => item.kind === "storage_limit",
    )!;
    expect(row.amount).toBe("Unknown");
    expect(row.amountNative).toBeNull();
    expect(
      validateFreshOperation(value).some(
        (blocker) => blocker.code === "UnknownResourceRequirement",
      ),
    ).toBe(true);
  });
});
