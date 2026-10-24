import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const full = `0x${"1".repeat(64)}`;

test("account addresses expand and collapse with the keyboard", async ({
  page,
}) => {
  await page.goto(`${harness}#team`);
  const account = page
    .locator(".member-list li")
    .filter({ hasText: "Alice" })
    .first();
  await expect(account.locator(".address-value code")).toHaveText(
    "0x111111…111111",
  );
  await expect(account.locator(".address-full")).toBeHidden();
  const reveal = account.getByRole("button", {
    name: "Show full address",
    exact: true,
  });
  await reveal.focus();
  await page.keyboard.press("Enter");
  await expect(account.locator(".address-full")).toHaveText(full);
  await expect(account.locator(".address-full")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account.locator(".address-full")).toBeHidden();
  await expect(reveal).toBeFocused();
});

test("copying a compact address uses its exact value and resets when the account changes", async ({
  page,
}) => {
  await page.goto(harness);
  await page.evaluate(() => {
    const values: string[] = [];
    Object.defineProperty(window, "__copiedAddresses", { value: values });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          values.push(value);
        },
      },
    });
  });
  const selected = page.locator(".wallet-details");
  await selected
    .getByRole("button", { name: "Copy signing account address", exact: true })
    .click();
  await expect(
    selected.getByRole("button", {
      name: "Copied signing account address",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __copiedAddresses: string[] })
          .__copiedAddresses,
    ),
  ).toEqual([full]);
  await page.getByLabel("Personal account").selectOption(`0x${"2".repeat(64)}`);
  await expect(
    selected.getByRole("button", {
      name: "Copy signing account address",
      exact: true,
    }),
  ).toBeVisible();
  await expect(selected.locator(".address-value code")).toHaveText(
    "0x222222…222222",
  );
});

test("failed copying reveals the full value for manual copying", async ({
  page,
}) => {
  await page.goto(`${harness}#team`);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error("Clipboard unavailable");
        },
      },
    }),
  );
  const account = page
    .locator(".member-list li")
    .filter({ hasText: "Alice" })
    .first();
  await account
    .getByRole("button", { name: "Copy address", exact: true })
    .click();
  await expect(account.getByRole("alert")).toContainText("Copy failed");
  await expect(account.locator(".address-full")).toBeVisible();
  await expect(account.locator(".address-full")).toHaveText(full);
});

test("the signer stays fully visible in operation review", async ({ page }) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page
    .getByRole("button", { name: "Prepare for review", exact: true })
    .click();
  const route = page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Execution route", exact: true }),
    });
  await expect(route.locator(".address-wrap > .address")).toHaveText(full);
  await expect(
    route.getByRole("button", { name: "Show full signer address" }),
  ).toHaveCount(0);
});
