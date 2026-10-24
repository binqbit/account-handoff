import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
for (const route of [
  "overview",
  "milestones",
  "team",
  "history",
  "network",
  "data",
  "setup",
]) {
  test(`${route} exposes labelled controls and accessible structure`, async ({
    page,
  }) => {
    await page.goto(`${harness}#${route}`);
    await expect(page.locator("h1")).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });
}
test("narrow view retains every destination without document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  await expect(
    page.getByRole("button", { name: "Мережа та готовність", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Дані простору", exact: true }),
  ).toBeVisible();
  for (const route of [
    "overview",
    "milestones",
    "team",
    "history",
    "network",
    "data",
    "setup",
  ]) {
    await page.goto(`${harness}#${route}`);
    await expect(page.locator("h1")).toBeVisible();
    const size = await page.locator("body").evaluate((element) => ({
      width: element.scrollWidth,
      viewport: innerWidth,
    }));
    expect(size.width, route).toBeLessThanOrEqual(size.viewport);
  }
});
test("keyboard navigation and disclosures never request a signature", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page.getByRole("button", { name: "Підготувати до перегляду" }).click();
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Запросити підпис" }),
  ).toBeEnabled();
  await page
    .getByText("Точний RuntimeCall і підтверджені ідентифікатори", {
      exact: true,
    })
    .click();
  await expect(page.getByText("0x0102", { exact: false })).toBeVisible();
  const types = await page.evaluate(() =>
    (
      window as unknown as { __uiTest: { commands: { type: string }[] } }
    ).__uiTest.commands.map((command) => command.type),
  );
  expect(types).toEqual(["prepare-operation"]);
});
