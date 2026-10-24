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
    page.getByRole("button", { name: "Network and readiness", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace data", exact: true }),
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
  await page.getByRole("button", { name: "Prepare for review" }).click();
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Request signature" }),
  ).toBeEnabled();
  await page
    .getByText("Exact RuntimeCall and verified identifiers", {
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

test("native payer addresses and exact fee amounts stay inside the review card", async ({
  page,
}, testInfo) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page
    .getByRole("button", { name: "Prepare for review", exact: true })
    .click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const resources = page.locator(".resource-list");
    await expect(resources).toContainText(
      "5CT5jwBEAhveEjgiSCQbkaKcKcUyF3VJ8qNXM9rXsuQyn3Kd",
    );
    await expect(resources).toContainText("0.00000008132674 UNIT");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await resources
        .locator("div,span,strong,small")
        .evaluateAll((elements) =>
          elements.every(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`native-resource-review-${width}.png`),
      fullPage: true,
    });
  }
});
