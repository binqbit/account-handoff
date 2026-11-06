import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("workspace search handles unmatched names and ignores letter case", async ({
  page,
}) => {
  await page.goto(`${harness}#workspaces`);
  const search = page.getByRole("searchbox", {
    name: "Find a workspace",
    exact: true,
  });
  await search.fill("Unrelated team");
  await expect(
    page.getByRole("heading", {
      name: "No workspace matches this name",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toHaveCount(0);
  await search.fill("ATLAS");
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
});

test("the actual application retains rejected JSON and permits dismissing its error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#data");
  const json = page.getByLabel("Or paste JSON");
  await json.fill('{"broken":');
  await page
    .getByRole("button", { name: "Verify and import", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(json).toHaveValue('{"broken":');
  await expect(
    page.getByText("The notification shows the validation result.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("oversized package files are rejected before their contents are read", async ({
  page,
}) => {
  await page.goto("/#data");
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "The package exceeds 5 MiB. The file was not read.",
  );
  await expect(page.getByLabel("Or paste JSON")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Verify and import", exact: true }),
  ).toBeDisabled();
});

test("workspace export reaches the browser download with the supplied unsigned contents", async ({
  page,
}) => {
  await page.goto(`${harness}#data`);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download package", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("test-unsigned.json");
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual({
    synthetic: true,
  });
});

test("choosing a JSON file loads its exact contents and displays its name", async ({
  page,
}) => {
  await page.goto("/#data");
  const contents = '{"workspace":"exact file contents"}\n';
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await expect(page.getByLabel("Or paste JSON")).toHaveValue(contents);
  await expect(page.getByText("workspace.json", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify and import", exact: true }),
  ).toBeEnabled();
});

test("a package file read failure is visible and does not enable import", async ({
  page,
}) => {
  await page.addInitScript(() => {
    File.prototype.text = async () => {
      throw new DOMException("File unavailable", "NotReadableError");
    };
  });
  await page.goto("/#data");
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "unreadable.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.getByRole("alert")).toHaveText("Could not read the file.");
  await expect(page.getByLabel("Or paste JSON")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Verify and import", exact: true }),
  ).toBeDisabled();
});

test("setting a review aside clears only that local review and explains retained authority", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page
    .getByRole("button", { name: "Prepare for review", exact: true })
    .click();
  await expect(
    page.getByText(
      "Setting this review aside does not cancel an on-chain proposal or revoke existing signatures.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set review aside", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare for review", exact: true }),
  ).toBeVisible();
  const state = await page.evaluate(() => {
    const ui = (
      window as unknown as {
        __uiTest: {
          commands: { type: string }[];
          getSnapshot(): {
            workspace: { authority: string };
            operation: unknown;
          };
        };
      }
    ).__uiTest;
    return {
      commands: ui.commands.map((command) => command.type),
      workspace: ui.getSnapshot().workspace,
      operation: ui.getSnapshot().operation,
    };
  });
  expect(state.commands).toEqual(["prepare-operation", "discard-operation"]);
  expect(state.workspace.authority).toBe("M0");
  expect(state.operation).toBeNull();
});

test("a late file read cannot overwrite JSON typed after file selection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    File.prototype.text = async () =>
      new Promise<string>((resolve) => {
        (window as unknown as { finishPackageRead(): void }).finishPackageRead =
          () => resolve('{"from":"selected file"}');
      });
  });
  await page.goto("/#data");
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  const json = page.getByLabel("Or paste JSON");
  await json.fill('{"from":"typed draft"}');
  await page.evaluate(async () => {
    (window as unknown as { finishPackageRead(): void }).finishPackageRead();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(json).toHaveValue('{"from":"typed draft"}');
  await expect(page.getByText("slow.json", { exact: true })).toHaveCount(0);
});

test("history exposes saved outcome layers and reconciles only its matching retained attempt", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=unknown-history#history`);
  await expect(
    page.getByRole("heading", { name: "Saved uncertain attempt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Outer transaction", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Business outcome", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Record evidence and technical details", { exact: true })
    .click();
  await expect(page.locator("pre")).toContainText('"kind": "synthetic"');
  await page
    .getByRole("button", { name: "Reconcile this attempt", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands,
    ),
  ).toEqual([{ type: "reconcile-operation", id: "test-operation" }]);
});

test("keyboard file selection reaches the visible chooser without a hidden input stop", async ({
  page,
}) => {
  await page.goto(`${harness}#data`);
  await page.getByRole("heading", { level: 1 }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Choose a JSON file", exact: true }),
  ).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "keyboard.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.getByLabel("Or paste JSON")).toHaveValue("{}");
});

test("creating a workspace works when the funder is the last completed field", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup#setup`);
  await page.getByLabel("Workspace name").fill("Last field funder");
  for (const [label, members] of [
    ["Current signers", [1, 2, 3]],
    ["Reviewer accounts", [2, 4]],
  ] as const) {
    for (const member of members) {
      const field = page.getByRole("combobox", {
        name: `Add account to ${label}`,
        exact: true,
      });
      await field.fill(`0x${String(member).repeat(64)}`);
      await field.press("Enter");
    }
  }
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(`0x${"1".repeat(64)}`);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __uiTest: { commands: { type: string }[] } }
      ).__uiTest.commands.map((command) => command.type),
    ),
  ).toEqual(["create-workspace"]);
});
