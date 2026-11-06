import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

for (const route of ["docs", "review?action=GRC-ROTATION-ADD-M1"]) {
  test(`skip navigation preserves the ${route} route and focuses its content`, async ({
    page,
  }) => {
    await page.goto(`${harness}#${route}`);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const title = await heading.textContent();
    const url = page.url();
    await page
      .getByRole("link", { name: "Skip to main content", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await expect(page).toHaveURL(url);
    await expect(heading).toHaveText(title!);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
            .commands,
      ),
    ).toEqual([]);
  });
}

test("operating budgets remain keyboard-scrollable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${harness}#team`);
  const budgets = page.getByRole("region", {
    name: "Operating budgets of participants and the beneficiary",
    exact: true,
  });
  await budgets.focus();
  await expect(budgets).toBeFocused();
  expect(
    await budgets.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => budgets.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});

test("grant history progress displays observed counts with a labelled progress bar", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=history-progress#overview`);
  await expect(
    page.getByText("16 of 32 blocks checked", { exact: true }),
  ).toBeVisible();
  const progress = page.getByRole("progressbar", {
    name: "Grant history blocks checked",
    exact: true,
  });
  await expect(progress).toHaveAttribute("value", "16");
  await expect(progress).toHaveAttribute("max", "32");
});

for (const route of ["handoff", "history"]) {
  test(`the active ${route} task stays within mobile workspace navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${harness}#${route}`);
    const navigation = page.getByRole("navigation", {
      name: "Workspace",
      exact: true,
    });
    const tab = navigation.locator('[aria-current="page"]');
    await expect
      .poll(async () => {
        const selected = await tab.boundingBox();
        const bounds = await navigation.boundingBox();
        return (
          !!selected &&
          !!bounds &&
          selected.x >= bounds.x - 1 &&
          selected.x + selected.width <= bounds.x + bounds.width + 1
        );
      })
      .toBe(true);
  });
}
