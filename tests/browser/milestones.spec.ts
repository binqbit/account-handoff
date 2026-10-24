import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("known native approval counts display 2 and 0 without inventing reviewer identities", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=approval-counts#milestones`);
  const first = page.locator(".milestone-card").filter({
    has: page.getByRole("heading", { name: "Research", exact: true }),
  });
  const second = page.locator(".milestone-card").filter({
    has: page.getByRole("heading", { name: "Next deliverable", exact: true }),
  });
  await expect(first.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(second.getByText("0 of 2", { exact: true })).toBeVisible();
  await expect(first.getByText("Unknown", { exact: true })).toHaveCount(0);
  await expect(second.getByText("Unknown", { exact: true })).toHaveCount(0);
  await expect(first).not.toContainText("Alice");
  await expect(first).not.toContainText("Bob");
  await page.goto(`${harness}?scenario=approval-unknown#milestones`);
  await expect(first.getByText("Unknown", { exact: true })).toBeVisible();
  await expect(second.getByText("Unknown", { exact: true })).toBeVisible();
});
