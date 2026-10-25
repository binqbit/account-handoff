import { expect, type Page, type TestInfo } from "@playwright/test";
import { toFunctionSelector } from "viem";
import {
  contractAddress,
  type Hex,
  type NativeConnection,
} from "@account-handoff/native-adapter";
import {
  encodeApproval,
  encodeSubmission,
  readGrant,
} from "@account-handoff/grant-adapter";
import type { injectLocalWallet } from "../browser-wallet";
import { performApproval, captureActualWorkspace } from "../browser-support";
import { captureJournalEvidence } from "../journal-evidence";

/** Finish the exact UI-created grant; no storage override or artificial block clock. */
export async function completeGrantFromUi(
  page: Page,
  testInfo: TestInfo,
  input: {
    connection: NativeConnection;
    wallet: Awaited<ReturnType<typeof injectLocalWallet>>;
    pure: Hex;
    contract: Hex;
    grantId: bigint;
    priorSignatures?: number;
  },
): Promise<void> {
  const {
    connection,
    wallet,
    pure,
    contract,
    grantId,
    priorSignatures = 0,
  } = input;
  const before = await connection.readAccount(pure);
  const initialGrant = await readGrant(
    connection,
    wallet.accounts.F2,
    contract,
    grantId,
  );
  expect(initialGrant.milestones.map((m) => m.state)).toEqual([2, 1]);
  const expectedPayout = initialGrant.milestones[1]!.amount / 10000n;
  for (const [index, role] of (["R1_2", "R2_2"] as const).entries()) {
    await performApproval(
      page,
      role,
      wallet.accounts[role],
      "GRC-GRANT-APPROVE",
      { "Milestone under review": "1" },
    );
    const current = await readGrant(
      connection,
      wallet.accounts.F2,
      contract,
      grantId,
    );
    expect(current.milestones[1]!.approvals).toBe(index + 1);
    expect(current.milestones[1]!.state).toBe(index === 0 ? 1 : 2);
  }
  const paid = await connection.readAccount(pure);
  expect(paid.free - before.free).toBe(expectedPayout);
  expect(paid.proxies).toEqual(before.proxies);
  expect(paid.mappedTo).toBe(pure);

  // The contract rejects a duplicate payout and resubmission after final release.
  for (const [origin, data] of [
    [wallet.accounts.R1_2, encodeApproval(grantId, 1)],
    [pure, encodeSubmission(grantId, 1, "Must not resubmit released work")],
  ] as const) {
    await expect(
      connection.estimateContract(origin, contract, 0n, data),
    ).rejects.toThrow(toFunctionSelector("BadState()"));
  }
  const final = await connection.readAccount(pure);
  const grant = await readGrant(
    connection,
    wallet.accounts.F2,
    contract,
    grantId,
  );
  expect(final.frozen).toBe(0n);
  expect(final.vesting).toEqual([]);
  expect(final.free).toBe(paid.free);
  expect(final.reserved).toBe(paid.reserved);
  expect(final.proxies).toEqual(before.proxies);
  expect(final.mappedAddress).toBe(contractAddress(pure));
  expect(grant.grantee).toBe(initialGrant.grantee);
  expect(grant.milestones.map((m) => m.state)).toEqual([2, 2]);
  expect(wallet.requests.length + priorSignatures).toBe(30);
  await captureJournalEvidence(page, testInfo, connection, 30);
  await testInfo.attach("complete-grant-final-native-state", {
    body: JSON.stringify(
      { grantId, contract, before, paid, final, grant },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
    contentType: "application/json",
  });
  await captureActualWorkspace(page, testInfo, "complete-grant-unlocked");
  const signatureCount = wallet.requests.length;
  await page.reload();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Connected LOCAL/ }),
  ).toBeVisible();
  expect(wallet.requests).toHaveLength(signatureCount);
  console.info(
    "[LOCAL] Complete grant verified: both payouts, vesting unlocked, reload did not sign",
  );
}
