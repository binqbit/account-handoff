import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const card = (page: Page) =>
  page.locator(".card").filter({
    has: page.getByRole("heading", {
      name: "The grant stays with the beneficiary",
      exact: true,
    }),
  });

test("matching identities show one result and keep comparison details optional", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=identity-matched#handoff`);
  const identity = card(page);
  await expect(
    identity.getByRole("status", { name: "Identity verification" }),
  ).toContainText("Identity unchanged");
  await expect(
    identity.getByText("Matches baseline", { exact: true }),
  ).toHaveCount(0);
  await expect(identity.locator("details")).not.toHaveAttribute("open", "");
  await expect(identity.locator(".address-wrap:visible")).toHaveCount(3);
  const toggle = identity.locator("summary");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(
    identity.getByText("Saved and current", { exact: true }),
  ).toHaveCount(2);
  await expect(identity.locator("details")).toHaveAttribute("open", "");
});

test("a changed recipient is visible immediately with saved and current values", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=identity-changed#handoff`);
  const identity = card(page);
  await expect(
    identity.getByRole("alert", { name: "Identity verification" }),
  ).toContainText("Identity changed");
  await expect(
    identity.getByRole("alert", { name: "Identity verification" }),
  ).toContainText("Grant recipient");
  await expect(
    identity.getByText("Identity unchanged", { exact: true }),
  ).toHaveCount(0);
  await expect(identity.locator("details")).toHaveAttribute("open", "");
  const changed = identity.locator(".identity-comparison__row").filter({
    has: page.getByText("Grant recipient", { exact: true }),
  });
  await expect(changed.getByText("Saved", { exact: true })).toBeVisible();
  await expect(changed.getByText("Current", { exact: true })).toBeVisible();
  await expect(
    changed.locator(".address-value code").filter({ hasText: "0xaaaaaa" }),
  ).toBeVisible();
  await expect(
    changed.locator(".address-value code").filter({ hasText: "0xdddddd" }),
  ).toBeVisible();
});

test("an unknown comparison never claims the identities are unchanged", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=identity-unknown#handoff`);
  const identity = card(page);
  await expect(
    identity.getByRole("status", { name: "Identity verification" }),
  ).toContainText("Verification incomplete");
  await expect(
    identity.getByRole("status", { name: "Identity verification" }),
  ).toContainText("Grant recipient");
  await expect(
    identity.getByText("Identity unchanged", { exact: true }),
  ).toHaveCount(0);
  await identity.locator("summary").click();
  await expect(
    identity.getByText("Not verified", { exact: true }),
  ).toBeVisible();
});

test("a missing checkpoint has an explicit unchecked state", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=identity-unchecked#handoff`);
  const identity = card(page);
  await expect(
    identity.getByRole("status", { name: "Identity verification" }),
  ).toContainText("Not compared yet");
  await expect(identity.locator("details")).toHaveCount(0);
  await expect(
    identity.getByText("Identity unchanged", { exact: true }),
  ).toHaveCount(0);
});

test("comparison details and full addresses fit a narrow screen without signing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?scenario=identity-changed#handoff`);
  const identity = card(page);
  await identity
    .getByRole("button", { name: "Show full address", exact: true })
    .last()
    .click();
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    commands: (window as unknown as { __uiTest: { commands: unknown[] } })
      .__uiTest.commands,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  expect(width.commands).toEqual([]);
});
