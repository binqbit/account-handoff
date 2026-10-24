import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const first = `0x${"1".repeat(64)}`;
const second = `0x${"2".repeat(64)}`;

test("wallet accounts use a dark compact list with names and bounded addresses", async ({
  page,
}) => {
  await page.goto(harness);
  const picker = page.getByRole("combobox", {
    name: "Personal account",
    exact: true,
  });
  await expect(picker).toHaveAttribute("data-selected-address", first);
  await expect(page.locator(".wallet-details select")).toHaveCount(0);
  await picker.click();
  const list = page.getByRole("listbox", {
    name: "Wallet accounts",
    exact: true,
  });
  await expect(list.getByRole("option")).toHaveCount(4);
  await expect(list.getByRole("option").first()).toContainText("Alice");
  await expect(list.getByRole("option").first()).toContainText(
    "0x111111…111111",
  );
  expect(
    await list.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(24, 40, 43)");
  expect(
    await list.getByRole("option").first().getAttribute("title"),
  ).toBeNull();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations.map((item) => item.id)).toEqual([]);
  await page.getByRole("heading", { level: 1 }).click();
  await expect(list).toHaveCount(0);
});

test("keyboard selection changes the account once and escape closes the menu", async ({
  page,
}) => {
  await page.goto(harness);
  const picker = page.getByRole("combobox", {
    name: "Personal account",
    exact: true,
  });
  await picker.focus();
  await picker.press("ArrowDown");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(picker).toHaveAttribute("data-selected-address", second);
  await expect(picker).toBeFocused();
  await picker.click();
  await picker.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Wallet accounts" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands,
    ),
  ).toEqual([{ type: "select-account", address: second }]);
});

test("many accounts and long names fit the mobile header without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?scenario=wallet-menu`);
  const picker = page.getByRole("combobox", {
    name: "Personal account",
    exact: true,
  });
  await picker.click();
  const list = page.getByRole("listbox", { name: "Wallet accounts" });
  const bounds = await list.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(280);
  expect(
    await list.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await picker.press("End");
  await picker.press("Enter");
  await expect(picker).toHaveAttribute(
    "data-selected-address",
    `0x${"18".repeat(32)}`,
  );
});

test("an unselected wallet stays unselected until the user chooses an account", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=unselected-wallet`);
  const picker = page.getByRole("combobox", {
    name: "Personal account",
    exact: true,
  });
  await expect(picker).toHaveText("Select an account");
  await expect(
    page.getByRole("button", {
      name: "Copy signing account address",
      exact: true,
    }),
  ).toHaveCount(0);
  await picker.click();
  await picker.press("Escape");
  await expect(picker).toHaveAttribute("data-selected-address", "");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands,
    ),
  ).toEqual([]);
});
