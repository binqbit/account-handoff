import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  exportPortable,
  sealRecord,
} from "@account-handoff/contracts";
import { exportWorkspacePackage } from "../../apps/web/src/application/workspace-package";
import { createWorkspaceRecord } from "../../apps/web/src/application/workspace-state";
import { HASH, account, profile, snapshot } from "../fixtures/core";
import type { AppCommand } from "../../apps/web/src/ui-contract";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const synthetic = '{"synthetic":"workspace package for UI controls"}';
const address = (index: number) => `0x${String(index).repeat(64)}`;
type Controls = {
  commands: AppCommand[];
  setNetworkConnected(connected: boolean): void;
  setNetworkState(change: {
    connected?: boolean;
    checking?: boolean;
    reconnecting?: boolean;
  }): void;
  setBusy(busy: string | null): void;
  finishPackageReview(): void;
  finishManualConnect(): void;
};
async function commands(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __uiTest: Controls }).__uiTest.commands,
  );
}
async function review(page: Page, contents = synthetic) {
  await page.getByLabel("Or paste JSON").fill(contents);
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toBeVisible();
}
async function addAccount(page: Page, label: string, index: number) {
  const field = page.getByRole("combobox", {
    name: `Add account to ${label}`,
    exact: true,
  });
  await field.fill(address(index));
  await field.press("Enter");
}
async function fillLegacyRoles(page: Page) {
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Recovered legacy workspace");
  for (const index of [1, 2, 3])
    await addAccount(page, "Current signers", index);
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(address(8));
  for (const index of [6, 7])
    await addAccount(page, "Reviewer accounts", index);
  await page
    .getByLabel("Replacement signing group", { exact: true })
    .selectOption("none");
}
async function canonicalBackup(name: string) {
  const p = await sealRecord({ ...(await profile()), genesis: HASH });
  const s = await snapshot(p);
  const w = createWorkspaceRecord(
    {
      name,
      oldMembers: [account(1), account(2), account(3)],
      threshold: 2,
      funder: account(4),
      reviewers: [account(5), account(6)],
    },
    "LOCAL",
    HASH as `0x${string}`,
  );
  const contents = canonicalJson(await exportWorkspacePackage(w, [p, s]));
  return { p, s, contents };
}

test("a successful canonical package review clears only the previous package error in the actual fresh application", async ({
  page,
}) => {
  const { contents } = await canonicalBackup(
    "Valid backup after malformed JSON",
  );
  await page.goto("/#data");
  await page.getByLabel("Or paste JSON").fill('{"broken":');
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  const error = page.locator(".notification[role=alert]");
  await expect(error).toBeVisible();
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "valid-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await expect(error).toBeVisible();
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toContainText("Valid backup after malformed JSON");
  await expect(error).toHaveCount(0);
});

test("a successful package review preserves an unrelated command error", async ({
  page,
}) => {
  await page.goto(`${harness}?reject=export-package#data`);
  await page
    .getByRole("button", { name: "Download package", exact: true })
    .click();
  const error = page.locator(".notification[role=alert]");
  await expect(error).toContainText("Synthetic export-package failure");
  await review(page);
  await expect(error).toContainText("Synthetic export-package failure");
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "export-package",
    "inspect-package",
  ]);
});

test("a canonical workspace backup can be reviewed in a fresh actual application before connecting, and survives network navigation", async ({
  page,
}) => {
  const { p, s, contents } = await canonicalBackup("Offline reviewed backup");
  const rpcSockets: string[] = [];
  page.on("websocket", (socket) => {
    if (
      !socket
        .url()
        .startsWith(new URL(page.url()).origin.replace("http:", "ws:"))
    )
      rpcSockets.push(socket.url());
  });
  await page.goto("/#data");
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "account-handoff-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Package review",
    exact: true,
  });
  await expect(preview).toContainText("Offline reviewed backup");
  await expect(preview).toContainText("Workspace backup");
  await expect(
    page.getByRole("button", { name: "Restore workspace", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Open network setup", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to package import", exact: true })
    .click();
  await expect(page.getByLabel("Or paste JSON")).toHaveValue(contents);
  await expect(
    page.getByText("account-handoff-workspace.json", { exact: true }),
  ).toBeVisible();
  await expect(preview).toContainText("Offline reviewed backup");
  await expect(
    page.getByRole("button", { name: "Restore workspace", exact: true }),
  ).toBeDisabled();
  await review(page, canonicalJson(await exportPortable([p, s])));
  await expect(preview).toContainText("Evidence only");
  await expect(
    page.getByLabel("Workspace name", { exact: true }),
  ).toBeEditable();
  await expect(
    page.getByText("Open the matching workspace first", { exact: true }),
  ).toHaveCount(0);
  expect(rpcSockets).toEqual([]);
});

test("a package can be reviewed while a manual Connect command is still pending", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=slow-manual-connect#network`);
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.locator(".activity-indicator")).toBeVisible();
  await page
    .getByRole("button", { name: "Workspace data", exact: true })
    .click();
  await review(page);
  await expect(
    page.getByRole("button", { name: "Restore workspace", exact: true }),
  ).toBeDisabled();
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "connect-network",
    "inspect-package",
  ]);
  await page.evaluate(() =>
    (
      window as unknown as { __uiTest: Controls }
    ).__uiTest.finishManualConnect(),
  );
  await expect(
    page.getByRole("button", { name: "Restore workspace", exact: true }),
  ).toBeEnabled();
});

test("review works during automatic connection without saving until an explicit ready confirmation", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=setup-checking&mode=DEMO#data`);
  await review(page);
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "inspect-package",
  ]);
  const restore = page.getByRole("button", {
    name: "Restore workspace",
    exact: true,
  });
  await expect(restore).toBeDisabled();
  await page.evaluate(() => {
    const ui = (window as unknown as { __uiTest: Controls }).__uiTest;
    ui.setNetworkConnected(true);
    ui.setBusy(null);
  });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(page).toHaveURL(/#overview$/);
  const calls = await commands(page);
  expect(calls.map((command) => command.type)).toEqual([
    "inspect-package",
    "import-package",
  ]);
  expect(calls[1]).toEqual({
    type: "import-package",
    contents: synthetic,
    previewDigest: createHash("sha256").update(synthetic).digest("hex"),
  });
});

test("full package configuration is read-only and displays grant ID zero", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup#data`);
  await review(page);
  await page
    .getByText("Public configuration from the package", { exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Package review",
    exact: true,
  });
  await expect(
    preview
      .locator("dt")
      .filter({ hasText: /^Grant ID$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("0");
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("combobox", { name: "Funder account", exact: true }),
  ).toHaveCount(0);
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "inspect-package",
  ]);
});

test("editing JSON or choosing another file invalidates the previous preview", async ({
  page,
}) => {
  await page.goto(`${harness}#data`);
  await review(page);
  await page.getByLabel("Or paste JSON").fill('{"changed":true}');
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Choose a JSON package").setInputFiles({
    name: "another.json",
    mimeType: "application/json",
    buffer: Buffer.from(synthetic),
  });
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toHaveCount(0);
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "inspect-package",
    "inspect-package",
  ]);
});

test("a failed final restore retains the reviewed package and never advances", async ({
  page,
}) => {
  await page.goto(`${harness}?reject=import-package#data`);
  await review(page);
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic import-package failure",
  );
  await expect(page).toHaveURL(/#data$/);
  await expect(page.getByLabel("Or paste JSON")).toHaveValue(synthetic);
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toBeVisible();
});

test("legacy evidence requires public completion and preserves the known beneficiary and grant zero", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=package-legacy#data`);
  await review(page);
  await fillLegacyRoles(page);
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  const call = (await commands(page)).find(
    (command) => command.type === "import-package",
  );
  expect(call).toMatchObject({
    type: "import-package",
    workspaceInput: {
      name: "Recovered legacy workspace",
      oldMembers: [address(1), address(2), address(3)],
      funder: address(8),
      reviewers: [address(6), address(7)],
      beneficiary: address(5),
      grantId: "0",
      newMembers: [],
    },
  });
});

test("legacy unknown beneficiary, grant and replacement require explicit absence choices", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=package-legacy-unknown#data`);
  await review(page);
  await fillLegacyRoles(page);
  const beneficiary = page.getByLabel("Pure beneficiary", { exact: true });
  const grant = page.getByLabel("Grant connection", { exact: true });
  await expect(beneficiary).toHaveValue("");
  await expect(grant).toHaveValue("");
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "inspect-package",
  ]);
  await beneficiary.selectOption("none");
  await grant.selectOption("none");
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  const call = (await commands(page)).find(
    (command) => command.type === "import-package",
  );
  expect(call).toMatchObject({
    type: "import-package",
    workspaceInput: { beneficiary: "", contract: "", newMembers: [] },
  });
});

test("legacy completion can explicitly retain an existing beneficiary, grant zero and planned replacement", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=package-legacy-unknown#data`);
  await review(page);
  await fillLegacyRoles(page);
  await page
    .getByLabel("Replacement signing group", { exact: true })
    .selectOption("planned");
  for (const index of [1, 2, 4])
    await addAccount(page, "Replacement signers", index);
  await page
    .getByLabel("Pure beneficiary", { exact: true })
    .selectOption("existing");
  await page
    .getByRole("combobox", { name: "Pure beneficiary address", exact: true })
    .fill(address(5));
  await page
    .getByLabel("Creation block hash", { exact: true })
    .fill(`0x${"a".repeat(64)}`);
  await page
    .getByLabel("Creation transaction hash", { exact: true })
    .fill(`0x${"b".repeat(64)}`);
  await page
    .getByLabel("Grant connection", { exact: true })
    .selectOption("existing");
  await page
    .getByRole("combobox", { name: "Grant contract", exact: true })
    .fill(`0x${"b".repeat(40)}`);
  await page.getByLabel("Grant ID", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  const call = (await commands(page)).find(
    (command) => command.type === "import-package",
  );
  expect(call).toMatchObject({
    type: "import-package",
    workspaceInput: {
      beneficiary: address(5),
      contract: `0x${"b".repeat(40)}`,
      grantId: "0",
      newMembers: [address(1), address(2), address(4)],
      creation: {
        blockHash: `0x${"a".repeat(64)}`,
        transactionHash: `0x${"b".repeat(64)}`,
      },
    },
  });
});

test("matching legacy evidence can merge explicitly without fabricating a workspace configuration", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=package-matching#data`);
  await review(page);
  await expect(
    page.getByLabel("Restore destination", { exact: true }),
  ).toHaveValue("test-workspace");
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Merge evidence", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  const call = (await commands(page)).find(
    (command) => command.type === "import-package",
  );
  expect(call).toMatchObject({
    type: "import-package",
    targetWorkspaceId: "test-workspace",
  });
  expect(call && "workspaceInput" in call).toBe(false);
});

test("checking, reconnecting or a different network never enables restore", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=package-other-network#data`);
  await review(page);
  await expect(
    page.getByRole("button", { name: "Restore workspace", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Connect to the package's network before restoring.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${harness}#data`);
  await review(page);
  for (const change of [
    { checking: true },
    { checking: false, connected: false, reconnecting: true },
  ]) {
    await page.evaluate(
      (change) =>
        (window as unknown as { __uiTest: Controls }).__uiTest.setNetworkState(
          change,
        ),
      change,
    );
    await expect(
      page.getByRole("button", { name: "Restore workspace", exact: true }),
    ).toBeDisabled();
  }
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "inspect-package",
  ]);
});

test("an inspection completing after text edits cannot restore its obsolete preview", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=slow-package-review#data`);
  await page.getByLabel("Or paste JSON").fill(synthetic);
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewing package…", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Or paste JSON").fill('{"new":"draft"}');
  await page.evaluate(() =>
    (
      window as unknown as { __uiTest: Controls }
    ).__uiTest.finishPackageReview(),
  );
  await expect(
    page.getByRole("button", { name: "Review package", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Package review", exact: true }),
  ).toHaveCount(0);
});

test("review and legacy completion remain accessible without overflow at 390px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?scenario=package-legacy-unknown#data`);
  await review(page);
  await page
    .getByLabel("Pure beneficiary", { exact: true })
    .selectOption("existing");
  await page
    .getByLabel("Grant connection", { exact: true })
    .selectOption("existing");
  await page
    .getByLabel("Replacement signing group", { exact: true })
    .selectOption("planned");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("package-review-390.png"),
    fullPage: true,
  });
});
