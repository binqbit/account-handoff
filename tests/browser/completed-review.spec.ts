import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("completed reviews show confirmation instead of an inactive signing checkbox", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=completed-review#review`);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByText("Transaction confirmed. This review can be closed."),
  ).toBeVisible();
  const close = page.getByRole("button", {
    name: "Set review aside",
    exact: true,
  });
  await expect(close).toBeEnabled();
  await close.click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __uiTest: { commands: { type: string }[] } }
      ).__uiTest.commands.map((c) => c.type),
    ),
  ).toEqual(["discard-operation"]);
});
