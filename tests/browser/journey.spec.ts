import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
test("four destinations retain the same beneficiary and separate operation stages", async ({
  page,
}) => {
  await page.goto(harness);
  await expect(
    page.getByRole("heading", { name: "Atlas Research", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Grant and milestones", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Continue work on the same grant",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Next deliverable" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "People change. The beneficiary stays.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hand off control", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Three actions. One stable beneficiary.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review the next action" }).click();
  await page.getByRole("button", { name: "Prepare for review" }).click();
  const sign = page.getByRole("button", { name: "Request signature" });
  await expect(sign).toBeDisabled();
  await expect(
    page.getByText("M0 remains authorized.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await sign.click();
  const send = page.getByRole("button", {
    name: "Send signed operation",
  });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  await send.click();
  await expect(
    page.getByRole("button", { name: "Request signature" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reconcile outcome", exact: true }),
  ).toBeVisible();
  const commands = await page.evaluate(() =>
    (
      window as unknown as { __uiTest: { commands: { type: string }[] } }
    ).__uiTest.commands.map((command) => command.type),
  );
  expect(commands).toEqual([
    "prepare-operation",
    "sign-operation",
    "send-operation",
  ]);
});
test("changing the account invalidates review without prompting or sending", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page.getByRole("button", { name: "Prepare for review" }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Personal account").selectOption(`0x${"2".repeat(64)}`);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Request signature" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Account changed. A new review is required."),
  ).toBeVisible();
  const types = await page.evaluate(() =>
    (
      window as unknown as { __uiTest: { commands: { type: string }[] } }
    ).__uiTest.commands.map((command) => command.type),
  );
  expect(types).toEqual(["prepare-operation", "select-account"]);
});
test("UTF-8 evidence limit blocks preparation and retains text", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-GRANT-SUBMIT-M1`);
  const evidence = page.getByRole("textbox", {
    name: "Public evidence",
    exact: true,
  });
  await evidence.fill("é".repeat(513));
  await page.getByRole("button", { name: "Prepare for review" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "exceeds 1024 UTF-8 bytes",
  );
  await expect(evidence).toHaveValue("é".repeat(513));
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands.length,
    ),
  ).toBe(0);
});
test("empty workspace exposes setup and actual network configuration without a fake success", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=empty`);
  await expect(
    page.getByRole("heading", {
      name: "The team changes. The grant stays.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with a stable beneficiary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "Add account to Current signers",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create workspace" }),
  ).toBeDisabled();
});
