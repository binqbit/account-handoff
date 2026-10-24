import { expect, type Page } from "@playwright/test";

export async function readCreationLocator(page: Page, pure: string) {
  let result: { blockHash: string; transactionHash: string } | null = null;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["pure"] === pure && Array.isArray(record["creationEvidence"])) {
      const evidence = record["creationEvidence"][0] as
        { locator: string; sourceId: string } | undefined;
      if (evidence)
        result = {
          blockHash: evidence.locator.split("/")[0]!,
          transactionHash: evidence.sourceId,
        };
    }
    for (const child of Object.values(record)) visit(child);
  }
  visit(await page.context().storageState({ indexedDB: true }));
  if (!result) throw new Error("The saved Pure creation locator is missing");
  return result as { blockHash: string; transactionHash: string };
}

export async function connectExistingWorkspaceThroughUi(
  page: Page,
  input: {
    name: string;
    members: string[];
    controller: string;
    funder: string;
    reviewers: string[];
    pure: string;
    contract: string;
    grantId: string;
    creation: { blockHash: string; transactionHash: string };
  },
) {
  await page.evaluate(() => {
    window.location.hash = "setup";
  });
  await page
    .getByRole("button", { name: "Connect existing", exact: true })
    .click();
  await page.getByLabel("Workspace name").fill(input.name);
  await page
    .getByRole("combobox", { name: "Existing multisig address", exact: true })
    .fill(input.controller);
  for (const address of input.members) {
    const field = page.getByRole("combobox", {
      name: "Add account to Current signers",
      exact: true,
    });
    await field.fill(address);
    await field.press("Enter");
  }
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(input.funder);
  for (const address of input.reviewers) {
    const field = page.getByRole("combobox", {
      name: "Add account to Reviewer accounts",
      exact: true,
    });
    await field.fill(address);
    await field.press("Enter");
  }
  await page
    .getByRole("button", {
      name: "Attach an existing beneficiary or grant",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Pure beneficiary address", exact: true })
    .fill(input.pure);
  await page
    .getByLabel("Creation block hash", { exact: true })
    .fill(input.creation.blockHash);
  await page
    .getByLabel("Creation transaction hash", { exact: true })
    .fill(input.creation.transactionHash);
  await page
    .getByRole("combobox", { name: "Grant contract (optional)", exact: true })
    .fill(input.contract);
  await page
    .getByLabel("Grant ID (optional)", { exact: true })
    .fill(input.grantId);
  await page
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: input.name, exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(
    page.getByText("Replacement group", { exact: true }),
  ).toHaveCount(0);
}
