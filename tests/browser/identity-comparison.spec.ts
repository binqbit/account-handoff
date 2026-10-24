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

test("the beneficiary emblem and address stay aligned at desktop and phone widths", async ({
  page,
}) => {
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto(`${harness}#overview`);
    const beneficiary = page.locator(".card").filter({
      has: page.getByRole("heading", {
        name: "Grant beneficiary",
        exact: true,
      }),
    });
    const emblem = beneficiary.locator(".beneficiary-emblem");
    const label = beneficiary.locator(".identity");
    await expect(emblem).toHaveText("P");
    const iconBox = (await emblem.boundingBox())!;
    const labelBox = (await label.boundingBox())!;
    expect(labelBox.x).toBeGreaterThan(iconBox.x + iconBox.width);
    expect(
      Math.abs(
        labelBox.y + labelBox.height / 2 - iconBox.y - iconBox.height / 2,
      ),
    ).toBeLessThan(2);
    const expand = label
      .getByRole("button", { name: "Show full address", exact: true })
      .first();
    if (await expand.isVisible()) await expand.click();
    const size = await beneficiary.evaluate((el) => ({
      width: el.scrollWidth,
      visible: el.clientWidth,
    }));
    expect(size.width).toBeLessThanOrEqual(size.visible);
    const full = (await label.locator(".address-full:visible").boundingBox())!;
    expect(full.x).toBeGreaterThanOrEqual(iconBox.x + iconBox.width);
  }
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
