import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("new visitors get a useful home page and a guide without connecting a wallet", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The team changes. The grant stays." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Start in three steps" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Read the guide", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A guide to Account Handoff" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Guide sections" })
    .getByRole("button", { name: "Accounts", exact: true })
    .click();
  await expect(page.locator("#docs-accounts")).toBeFocused();
  await expect(page).toHaveURL(/#docs$/);
  await page
    .getByRole("button", { name: "Account Handoff — home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start in three steps" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("getting started leads to the real network setup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await expect(page.getByLabel("Native WebSocket endpoint")).toBeVisible();
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await expect(
    page.getByText("Changing the signing group", { exact: true }),
  ).toBeVisible();
});

test("public navigation remains available with an existing workspace", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=public-home`);
  await page
    .getByRole("button", { name: "Open current workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Atlas Research", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A guide to Account Handoff" }),
  ).toBeVisible();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(commands).toEqual([]);
});

for (const route of ["home", "docs"])
  test(`${route} is accessible and fits a narrow screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${route}`);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations.map((item) => item.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
