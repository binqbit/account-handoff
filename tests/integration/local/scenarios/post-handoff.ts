import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  contractAddress,
  type Hex,
  type NativeConnection,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import type { injectLocalWallet } from "../browser-wallet";
import {
  performApproval,
  selectPersonalAccount,
  runId,
} from "../browser-support";
import {
  connectExistingWorkspaceThroughUi,
  readCreationLocator,
} from "../connect-workspace";
import { completeGrantFromUi } from "./completion";
import { completeVestingFromUi } from "./vesting-completion";

/** Also used to resume the retained pre-maintenance verification checkpoint. */
export async function finishSetupJourney(
  page: Page,
  testInfo: TestInfo,
  input: {
    connection: NativeConnection;
    wallet: Awaited<ReturnType<typeof injectLocalWallet>>;
    pure: Hex;
    m0: string;
    contract: Hex;
    grantId: bigint;
    grantee: string;
    priorSignatures?: number;
  },
): Promise<void> {
  const {
    connection,
    wallet,
    pure,
    m0,
    contract,
    grantId,
    grantee,
    priorSignatures = 0,
  } = input;
  await completeVestingFromUi(page, testInfo, { connection, wallet, pure });
  expect(wallet.requests.length + priorSignatures).toBe(24);
  // A second control change uses the same Pure and grant, with no new milestone claim.
  await page
    .getByRole("button", { name: "Control handoff", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start another handoff", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Choose the replacement group",
      exact: true,
    }),
  ).toBeVisible();
  const group = page.getByRole("group", {
    name: "Replacement signers",
    exact: true,
  });
  for (let index = 0; index < 2; index++)
    await group
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
  for (const role of ["A", "B", "C"] as const) {
    const field = page.getByRole("combobox", {
      name: "Add account to Replacement signers",
      exact: true,
    });
    await field.fill(wallet.accounts[role]);
    await field.press("Enter");
  }
  await page
    .getByRole("button", { name: "Prepare handoff", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Three actions. One stable beneficiary.",
    }),
  ).toBeVisible();
  for (const role of ["A", "B"] as const)
    await performApproval(
      page,
      role,
      wallet.accounts[role],
      "GRC-ROTATION-ADD-M1",
    );
  for (const role of ["A", "C"] as const)
    await performApproval(
      page,
      role,
      wallet.accounts[role],
      "GRC-ROTATION-REMOVE-M0",
    );
  const finalState = await connection.readAccount(pure);
  expect(finalState.proxies).toEqual([
    { delegate: m0, proxyType: "Any", delay: 0 },
  ]);
  expect(finalState.mappedAddress).toBe(contractAddress(pure));
  const unchangedGrant = await readGrant(
    connection,
    wallet.accounts.F2,
    contract,
    grantId,
  );
  expect(unchangedGrant.grantee).toBe(grantee);
  expect(unchangedGrant.milestones[1]!.state).toBe(1);
  expect(wallet.requests.length + priorSignatures).toBe(28);
  console.info(
    "[LOCAL] Second handoff is finalized; beneficiary and grant are unchanged",
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Previous control handoffs",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("second-handoff-same-beneficiary.png"),
    fullPage: true,
  });
  const creation = await readCreationLocator(page, pure);
  await connectExistingWorkspaceThroughUi(page, {
    name: `Connected LOCAL ${runId}`,
    members: [wallet.accounts.A, wallet.accounts.B, wallet.accounts.C],
    controller: m0,
    funder: wallet.accounts.F2,
    reviewers: [wallet.accounts.R1_2, wallet.accounts.R2_2],
    pure,
    contract: contract,
    grantId: String(grantId),
    creation,
  });
  expect(wallet.requests.length + priorSignatures).toBe(28);
  console.info(
    "[LOCAL] Connected the existing controller, Pure and grant without signing",
  );
  // Address provenance alone does not import a historical continuity certificate.
  await selectPersonalAccount(page, wallet.accounts.A);
  await page.evaluate(() => {
    window.location.hash = "review?action=GRC-VESTING-VEST-OTHER";
  });
  await expect(
    page.getByRole("button", { name: "Prepare for review", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Complete and verify grant continuation first.", {
      exact: true,
    }),
  ).toBeVisible();
  await completeGrantFromUi(page, testInfo, {
    connection,
    wallet,
    pure,
    contract: contract,
    grantId,
    priorSignatures,
  });
}
