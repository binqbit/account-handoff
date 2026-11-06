import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

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
