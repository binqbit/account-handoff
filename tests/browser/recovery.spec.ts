import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("unknown outcome requires an explicit reconciliation without another signature or send", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=unknown#attention`);
  await expect(
    page.getByRole("heading", {
      name: "З’ясуйте результат перед наступною дією",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Відкрити спробу" }).click();
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Запросити підпис" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Надіслати підписану операцію" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Відкласти перегляд" }),
  ).toHaveCount(0);
  const before = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(before).toEqual([]);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Звірити результат", exact: true })
    .click();
  await expect(page.getByText("Finalized", { exact: true })).toBeVisible();
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          __uiTest: { commands: { type: string; id: string }[] };
        }
      ).__uiTest.commands,
  );
  expect(commands).toEqual([
    { type: "reconcile-operation", id: "test-operation" },
  ]);
});

test("read-only imported evidence is inspectable while preparation remains disabled", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=read-only#history`);
  await expect(
    page.getByText("Імпортований запис", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Імпорт не встановлює поточні права керування."),
  ).toBeVisible();
  await page
    .getByText("Доказ і технічні деталі запису", { exact: true })
    .click();
  await expect(page.locator("pre")).toContainText('"recordedAmount": "123"');
  await page
    .getByRole("button", { name: "Дані простору", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Завантажити пакет", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
  });
  await expect(
    page.getByText("Підключіть мережу й гаманець для нового перегляду."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Підготувати до перегляду" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Запросити підпис" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands.length,
    ),
  ).toBe(0);
});
