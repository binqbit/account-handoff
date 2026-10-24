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
      name: "Resolve the outcome before acting again",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open attempt" }).click();
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Request signature" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send signed operation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set review aside" }),
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
    .getByRole("button", { name: "Reconcile outcome", exact: true })
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
    page.getByText("Imported record", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Importing does not establish current control authority."),
  ).toBeVisible();
  await page
    .getByText("Record evidence and technical details", { exact: true })
    .click();
  await expect(page.locator("pre")).toContainText('"recordedAmount": "123"');
  await page
    .getByRole("button", { name: "Workspace data", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download package", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
  });
  await expect(
    page.getByText("Connect the network and wallet for a new review."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prepare for review" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Request signature" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands.length,
    ),
  ).toBe(0);
});
