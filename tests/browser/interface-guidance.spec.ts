import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("control handoff is directly discoverable and explains the stable beneficiary", async ({
  page,
}) => {
  await page.goto(harness);
  const navigation = page.getByRole("navigation", {
    name: "Workspace",
    exact: true,
  });
  await navigation
    .getByRole("button", { name: "Control handoff", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Three actions. One stable beneficiary.",
    }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Control handoff", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("button", { name: "Team", exact: true }).click();
  const help = page
    .locator("summary")
    .filter({ hasText: "How wallets, controllers and the beneficiary differ" });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "One person's signing account. A wallet connection alone does not grant authority.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The stable account named by the grant. Its address stays the same when the controller changes.",
    ),
  ).toBeVisible();
});

test("network help preserves the typed endpoint and distinguishes native RPC", async ({
  page,
}) => {
  await page.goto(`${harness}#network`);
  const input = page.getByLabel("Native WebSocket endpoint");
  await input.fill("ws://127.0.0.1:9966");
  await page.getByText("Which endpoint should I use?", { exact: true }).click();
  await expect(page.getByText("AH_NATIVE_PORT", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("ws://127.0.0.1:9966");
  await expect(input).toHaveAccessibleDescription(
    /An EVM HTTP RPC URL is a different endpoint/,
  );
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(commands).toEqual([]);
});

test("known contract input explains and checks the EVM address format", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  await page
    .getByRole("button", { name: "I know the P and grant addresses" })
    .click();
  const contract = page.getByRole("combobox", {
    name: "Known grant contract",
    exact: true,
  });
  await contract.fill(`0x${"1".repeat(64)}`);
  await page.getByLabel("Grant ID", { exact: true }).focus();
  await expect(contract).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText(
    "20-byte contract address",
  );
  await contract.fill(`0x${"b".repeat(40)}`);
  await page.getByLabel("Grant ID", { exact: true }).focus();
  await expect(contract).toHaveAttribute("aria-invalid", "false");
  await expect(
    page
      .locator(".address-picker__selected")
      .filter({ hasText: "Vestry contract" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("short desktop windows keep the sidebar settings reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(harness);
  await page
    .getByRole("button", { name: "Workspace data", exact: true })
    .click();
  await expect(page).toHaveURL(/#data$/);
  await page
    .getByRole("button", { name: "Network and readiness", exact: true })
    .click();
  await expect(page).toHaveURL(/#network$/);
});

test("setup keeps essential rules visible and preserves input when opening optional help", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  await page.getByLabel("Workspace name").fill("Compact workspace");
  await expect(
    page.getByText("2 of 3 signatures required. Replace one member."),
  ).toBeVisible();
  await expect(
    page.getByText("Both reviewers must approve.", { exact: true }),
  ).toBeVisible();
  const details = page.getByText(
    "The funder creates a grant for h(P) and funds its milestones.",
  );
  await expect(details).toBeHidden();
  await page.locator("summary").filter({ hasText: "How setup works" }).click();
  await expect(details).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toHaveValue(
    "Compact workspace",
  );
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(commands).toEqual([]);
});
