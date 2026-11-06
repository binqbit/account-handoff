import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const address = (index: number) => `0x${String(index).repeat(64)}`;

async function addAccount(page: Page, group: string, index: number) {
  const field = page.getByRole("combobox", {
    name: `Add account to ${group}`,
    exact: true,
  });
  await field.fill(address(index));
  await field.press("Enter");
}

test("a rejected workspace creation keeps the form and its values available", async ({
  page,
}) => {
  await page.goto(`${harness}?reject=create-workspace#setup`);
  await page.getByLabel("Workspace name").fill("Retain this team");
  for (const index of [1, 2, 3])
    await addAccount(page, "Current signers", index);
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(address(1));
  for (const index of [2, 4])
    await addAccount(page, "Reviewer accounts", index);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic create-workspace failure",
  );
  await expect(page).toHaveURL(/#setup$/);
  await expect(page.getByLabel("Workspace name")).toHaveValue(
    "Retain this team",
  );
  await expect(
    page
      .getByRole("group", { name: "Current signers", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(3);
});

test("a rejected workspace selection stays in the workspace list", async ({
  page,
}) => {
  await page.goto(`${harness}?reject=select-workspace#workspaces`);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic select-workspace failure",
  );
  await expect(page).toHaveURL(/#workspaces$/);
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
});

test("a rejected package review keeps its contents without showing a confirmation", async ({
  page,
}) => {
  await page.goto(`${harness}?reject=inspect-package#data`);
  const contents = '{"invalid":"package"}';
  await page.getByLabel("Or paste JSON").fill(contents);
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic inspect-package failure",
  );
  await expect(page.getByLabel("Or paste JSON")).toHaveValue(contents);
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toHaveCount(0);
});

test("successful workspace selection advances without a payload and package review still requires confirmation", async ({
  page,
}) => {
  await page.goto(`${harness}#workspaces`);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  await page
    .getByRole("button", { name: "Workspace data", exact: true })
    .click();
  await page.getByLabel("Or paste JSON").fill('{"synthetic":true}');
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toBeVisible();
});
