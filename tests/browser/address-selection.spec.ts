import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const address = (index: number) => `0x${String(index).repeat(64)}`;
async function choose(page: Page, field: string, name: string) {
  await page.getByRole("combobox", { name: field, exact: true }).fill(name);
  await page
    .getByRole("listbox")
    .getByRole("option")
    .filter({ hasText: name })
    .click();
}
async function paste(page: Page, field: string, text: string) {
  await page
    .getByRole("combobox", { name: field, exact: true })
    .evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
}
test("searchable account lists save the selected team without requesting signatures", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  await page.getByLabel("Workspace name").fill("New team");
  for (const name of ["Alice", "Bob", "Charlie"])
    await choose(page, "Add account to Current signers", name);
  await choose(page, "Funder account", "Alice");
  for (const name of ["Bob", "Dave"])
    await choose(page, "Add account to Reviewer accounts", name);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
        .commands,
  );
  expect(commands).toEqual([
    {
      type: "create-workspace",
      input: {
        name: "New team",
        oldMembers: [address(1), address(2), address(3)],
        threshold: 2,
        funder: address(1),
        reviewers: [address(2), address(4)],
      },
    },
  ]);
});
test("bulk paste accepts native addresses and rejects duplicates and incorrect formats", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  const field = "Add account to Current signers";
  await paste(page, field, `${address(1)},\n${address(2)}`);
  const group = page.getByRole("group", {
    name: "Current signers",
    exact: true,
  });
  await expect(group.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("combobox", { name: field }).fill(address(1));
  await page.getByRole("combobox", { name: field }).press("Enter");
  await expect(group.getByRole("alert")).toContainText("already in the group");
  await expect(group.getByRole("listitem")).toHaveCount(2);
  await paste(page, field, `0x${"a".repeat(40)}, invalid`);
  await expect(group.getByRole("alert")).toContainText(
    "No addresses were added",
  );
  await expect(group.getByRole("listitem")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove Alice from Current signers" })
    .click();
  await expect(group.getByRole("listitem")).toHaveCount(1);
});
test("keyboard account selection and mobile suggestions retain labels, addresses and accessibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}#setup`);
  const input = page.getByRole("combobox", {
    name: "Funder account",
    exact: true,
  });
  await input.focus();
  await expect(
    page.getByRole("listbox").getByRole("option").filter({ hasText: "Alice" }),
  ).toContainText("0x111111…111111");
  await expect(
    page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: "Alice" })
      .locator("code"),
  ).toHaveAttribute("title", address(1));
  await expect(
    page.getByRole("listbox").getByRole("option").filter({ hasText: "Alice" }),
  ).toContainText("Connected wallet");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(address(1));
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.fill(`0x${"b".repeat(40)}`);
  await page.getByLabel("Workspace name").focus();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText("native SS58");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("completing a group keeps keyboard focus inside the selected accounts", async ({
  page,
}) => {
  await page.goto(`${harness}#setup`);
  const field = page.getByRole("combobox", {
    name: "Add account to Current signers",
    exact: true,
  });
  await field.focus();
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByRole("button", { name: "Remove Charlie from Current signers" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page
      .locator(".derived-address")
      .getByRole("button", { name: "Show full address", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", {
      name: "Funder account",
      exact: true,
    }),
  ).toBeFocused();
});
