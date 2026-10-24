import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const address = (index: number) => `0x${String(index).repeat(64)}`;

test("replacement membership is requested only when starting a handoff", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=current-only#team`);
  await expect(
    page.getByText("Replacement group", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hand off control", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose the replacement group" }),
  ).toBeVisible();
  const beneficiary = page.locator(".card").filter({
    has: page.getByRole("heading", {
      name: "The grant stays with the beneficiary",
    }),
  });
  await expect(
    beneficiary.locator("code").filter({ hasText: "0x555555" }).first(),
  ).toBeVisible();
  const field = page.getByRole("combobox", {
    name: "Add account to Replacement signers",
    exact: true,
  });
  await field.fill(address(4));
  await field.press("Enter");
  await page
    .getByRole("button", { name: "Prepare handoff", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Three actions. One stable beneficiary.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands,
    ),
  ).toContainEqual({
    type: "plan-handoff",
    members: [address(1), address(2), address(4)],
  });
  await expect(
    page.getByRole("heading", { name: "The grant stays with the beneficiary" }),
  ).toBeVisible();
});

test("an existing multisig requires a matching address and membership", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  await page
    .getByRole("button", { name: "Connect existing", exact: true })
    .click();
  await page.getByLabel("Workspace name").fill("Existing group");
  for (const index of [1, 2, 3]) {
    const field = page.getByRole("combobox", {
      name: "Add account to Current signers",
      exact: true,
    });
    await field.fill(address(index));
    await field.press("Enter");
  }
  await page
    .getByRole("combobox", { name: "Existing multisig address", exact: true })
    .fill(address(8));
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(address(1));
  for (const index of [2, 4]) {
    const field = page.getByRole("combobox", {
      name: "Add account to Reviewer accounts",
      exact: true,
    });
    await field.fill(address(index));
    await field.press("Enter");
  }
  await page
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("does not match");
  await page
    .locator(".derived-address")
    .getByRole("button", { name: "Show full address", exact: true })
    .click();
  const derived = await page
    .locator(".derived-address .address-full")
    .textContent();
  await page
    .getByRole("combobox", { name: "Existing multisig address", exact: true })
    .fill(derived!);
  await page
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: "create-workspace",
    input: {
      controllerAddress: derived,
      oldMembers: [address(1), address(2), address(3)],
    },
  });
});

test("another handoff retains the beneficiary and records the previous controller change", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=rotated#handoff`);
  await page
    .getByRole("button", { name: "Start another handoff", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose the replacement group" }),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    (
      window as unknown as {
        __uiTest: { getSnapshot(): { workspace: unknown } };
      }
    ).__uiTest.getSnapshot(),
  );
  expect(state.workspace).toMatchObject({
    beneficiary: { address: address(5) },
    contract: `0x${"b".repeat(40)}`,
    grantId: "42",
    oldController: { address: address(7) },
    newController: null,
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Previous control handoffs" }),
  ).toBeVisible();
});
