import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import type {
  AppCommand,
  AppSnapshot,
  NetworkView,
  RuntimeMode,
} from "../../apps/web/src/ui-contract";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const address = (index: number) => `0x${String(index).repeat(64)}`;
type UiFixture = {
  commands: AppCommand[];
  setNetworkConnected(connected: boolean, mode?: RuntimeMode): void;
  setNetworkState(
    change: Partial<
      Pick<
        NetworkView,
        | "connected"
        | "checking"
        | "reconnecting"
        | "retryable"
        | "error"
        | "updatedAt"
      >
    >,
    notice?: AppSnapshot["notice"],
  ): void;
  allowNetworkConnection(): void;
};

async function commands(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __uiTest: UiFixture }).__uiTest.commands,
  );
}
async function connection(page: Page, connected: boolean, mode?: RuntimeMode) {
  await page.evaluate(
    ({ connected, mode }) =>
      (
        window as unknown as { __uiTest: UiFixture }
      ).__uiTest.setNetworkConnected(connected, mode),
    { connected, mode },
  );
}
async function networkState(
  page: Page,
  change: Parameters<UiFixture["setNetworkState"]>[0],
  notice?: AppSnapshot["notice"],
) {
  await page.evaluate(
    ({ change, notice }) =>
      (window as unknown as { __uiTest: UiFixture }).__uiTest.setNetworkState(
        change,
        notice,
      ),
    { change, notice },
  );
}
async function addAccount(page: Page, group: string, index: number) {
  const field = page.getByRole("combobox", {
    name: `Add account to ${group}`,
    exact: true,
  });
  await field.fill(address(index));
  await field.press("Enter");
}
async function fillTeam(page: Page, name: string) {
  await page.getByLabel("Workspace name").fill(name);
  for (const index of [1, 2, 3])
    await addAccount(page, "Current signers", index);
  for (const index of [2, 4])
    await addAccount(page, "Reviewer accounts", index);
  await page
    .getByRole("combobox", { name: "Funder account", exact: true })
    .fill(address(1));
  await page.getByLabel("Workspace name").focus();
}
async function teamValues(page: Page) {
  return {
    name: await page.getByLabel("Workspace name").inputValue(),
    members: await page
      .getByRole("group", { name: "Current signers", exact: true })
      .locator(".address-full code")
      .allTextContents(),
    reviewers: await page
      .getByRole("group", { name: "Reviewer accounts", exact: true })
      .locator(".address-full code")
      .allTextContents(),
    funder: await page
      .getByRole("combobox", { name: "Funder account", exact: true })
      .inputValue(),
    multisig: await page
      .locator(".derived-address .address-full code")
      .textContent(),
  };
}
async function expectGate(page: Page) {
  await expect(page.getByLabel("Workspace name")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", {
      name: "Add account to Current signers",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open network setup", exact: true }),
  ).toBeVisible();
}
async function openNetwork(page: Page) {
  await page
    .getByRole("button", { name: "Open network setup", exact: true })
    .click();
  await expect(page).toHaveURL(/#network$/);
  await expect(
    page.getByRole("button", { name: "Back to workspace setup", exact: true }),
  ).toBeVisible();
}
async function backToSetup(page: Page) {
  await page
    .getByRole("button", { name: "Back to workspace setup", exact: true })
    .click();
  await expect(page).toHaveURL(/#setup$/);
}

// The facade supplies network transitions only. Production TESTNET bootstrap is
// tested separately; this App fixture never opens a native RPC or wallet signer.
test("disconnected setup offers a manual connection route before editing, with a return even without a draft", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=fresh-setup-disconnected&mode=DEMO#setup`,
  );
  await expectGate(page);
  await openNetwork(page);
  await backToSetup(page);
  await expectGate(page);
  expect(await commands(page)).toEqual([]);
});

test("automatic recovery removes the facade-owned connection notice without retaining an App duplicate", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=fresh-setup-disconnected&mode=DEMO&reject=connect-network#network`,
  );
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.locator(".notification[role=alert]")).toContainText(
    "Synthetic connect-network failure",
  );
  // The application coordinator owns this notice and removes it on recovery.
  await networkState(
    page,
    {
      connected: true,
      checking: false,
      reconnecting: false,
      error: null,
      updatedAt: "2026-11-06T00:00:00.000Z",
    },
    null,
  );
  await expect(page.locator(".notification[role=alert]")).toHaveCount(0);
  await expect(
    page.getByText("Synthetic connect-network failure", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Network and readiness", exact: true }),
  ).toContainText("RPC online");
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "connect-network",
  ]);
});

test("network recovery preserves an unrelated facade error", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup&mode=DEMO#setup`);
  await networkState(
    page,
    { connected: false, checking: true, reconnecting: true },
    {
      id: "synthetic-storage-failure",
      tone: "negative",
      message: "Synthetic workspace storage failure",
    },
  );
  await expect(page.locator(".notification[role=alert]")).toContainText(
    "Synthetic workspace storage failure",
  );
  await networkState(page, {
    connected: true,
    checking: false,
    reconnecting: false,
    error: null,
  });
  await expect(page.locator(".notification[role=alert]")).toContainText(
    "Synthetic workspace storage failure",
  );
  expect(await commands(page)).toEqual([]);
});

for (const scenario of ["setup-checking", "setup-network-error"]) {
  test(`${scenario} keeps the editing form behind the connection gate`, async ({
    page,
  }) => {
    await page.goto(`${harness}?scenario=${scenario}&mode=DEMO#setup`);
    await expectGate(page);
    if (scenario === "setup-checking")
      await expect(
        page.getByRole("heading", {
          name: "Connecting to the network…",
          exact: true,
        }),
      ).toBeVisible();
    else
      await expect(
        page.getByText("Synthetic startup connection failure", { exact: true }),
      ).toBeVisible();
    expect(await commands(page)).toEqual([]);
  });
}

test("explicit manual retry makes the form available only after connection succeeds", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=fresh-setup-disconnected&mode=DEMO#setup`,
  );
  await openNetwork(page);
  expect(await commands(page)).toEqual([]);
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.getByText("RPC connected", { exact: true })).toBeVisible();
  await backToSetup(page);
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Open network setup", exact: true }),
  ).toHaveCount(0);
  expect(await commands(page)).toEqual([
    {
      type: "connect-network",
      mode: "DEMO",
      endpoint: "wss://test-node-v3.portaldot.dev",
    },
  ]);
});

test("a filled create draft survives lost connection and a visit to advanced network setup", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup&mode=DEMO#setup`);
  await fillTeam(page, "Preserved create draft");
  const before = await teamValues(page);
  await connection(page, false);
  await expect(page.getByLabel("Workspace name")).toBeEditable();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Network and readiness", exact: true }),
  ).toContainText("Connection interrupted");
  await openNetwork(page);
  await backToSetup(page);
  expect(await teamValues(page)).toEqual(before);
  await connection(page, true);
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  expect(await teamValues(page)).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeEnabled();
  expect(await commands(page)).toEqual([]);
});

test("failed reconnection preserves an existing-account draft and its grant-zero attachment for explicit retry", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=fresh-setup&mode=DEMO&reject=connect-network#setup`,
  );
  await page
    .getByRole("button", { name: "Connect existing", exact: true })
    .click();
  await fillTeam(page, "Preserved existing draft");
  const controller = (await teamValues(page)).multisig!;
  await page
    .getByRole("combobox", { name: "Existing multisig address", exact: true })
    .fill(controller);
  await page
    .getByRole("button", {
      name: "Attach an existing beneficiary or grant",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Pure beneficiary address", exact: true })
    .fill(address(5));
  await page.getByLabel("Creation block hash").fill(`0x${"a".repeat(64)}`);
  await page
    .getByLabel("Creation transaction hash")
    .fill(`0x${"b".repeat(64)}`);
  await page
    .getByRole("combobox", { name: "Grant contract (optional)", exact: true })
    .fill(`0x${"b".repeat(40)}`);
  await page.getByLabel("Grant ID (optional)", { exact: true }).fill("0");
  const before = await teamValues(page);
  const beneficiary = await page
    .getByRole("combobox", { name: "Pure beneficiary address", exact: true })
    .inputValue();
  await connection(page, false);
  await expect(page.getByLabel("Workspace name")).toBeEditable();
  await expect(
    page.getByRole("button", { name: "Connect workspace", exact: true }),
  ).toBeDisabled();
  await openNetwork(page);
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.locator(".notification[role=alert]")).toContainText(
    "Synthetic connect-network failure",
  );
  await backToSetup(page);
  expect(await teamValues(page)).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Connect workspace", exact: true }),
  ).toBeDisabled();
  await openNetwork(page);
  await page.evaluate(() =>
    (
      window as unknown as { __uiTest: UiFixture }
    ).__uiTest.allowNetworkConnection(),
  );
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.getByText("RPC connected", { exact: true })).toBeVisible();
  await backToSetup(page);
  await expect(
    page.getByRole("button", { name: "Connect existing", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await teamValues(page)).toEqual(before);
  await expect(
    page.getByRole("combobox", {
      name: "Existing multisig address",
      exact: true,
    }),
  ).toHaveValue(controller);
  await expect(
    page.getByRole("button", {
      name: "Attach an existing beneficiary or grant",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("combobox", {
      name: "Pure beneficiary address",
      exact: true,
    }),
  ).toHaveValue(beneficiary);
  await expect(page.getByLabel("Creation block hash")).toHaveValue(
    `0x${"a".repeat(64)}`,
  );
  await expect(page.getByLabel("Creation transaction hash")).toHaveValue(
    `0x${"b".repeat(64)}`,
  );
  await expect(
    page.getByRole("combobox", {
      name: "Grant contract (optional)",
      exact: true,
    }),
  ).toHaveValue(`0x${"b".repeat(40)}`);
  await expect(
    page.getByLabel("Grant ID (optional)", { exact: true }),
  ).toHaveValue("0");
  const sent = await commands(page);
  expect(sent.map((command) => command.type)).toEqual([
    "connect-network",
    "connect-network",
  ]);
});

test("uncommitted member and reviewer input survives navigation and disconnection without adding accounts", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup&mode=DEMO#setup`);
  await page.getByLabel("Workspace name").fill("Pending account input");
  await addAccount(page, "Current signers", 1);
  await addAccount(page, "Reviewer accounts", 2);
  const members = page.getByRole("combobox", {
    name: "Add account to Current signers",
    exact: true,
  });
  const reviewers = page.getByRole("combobox", {
    name: "Add account to Reviewer accounts",
    exact: true,
  });
  await members.fill("5Grwva");
  await reviewers.fill(address(4));
  const pendingReviewer = await reviewers.inputValue();
  await page
    .getByRole("button", { name: "Network and readiness", exact: true })
    .click();
  await backToSetup(page);
  await expect(members).toHaveValue("5Grwva");
  await expect(reviewers).toHaveValue(pendingReviewer);
  await connection(page, false);
  await expect(members).toBeEditable();
  await expect(reviewers).toBeEditable();
  await connection(page, true);
  await expect(members).toHaveValue("5Grwva");
  await expect(reviewers).toHaveValue(pendingReviewer);
  await expect(
    page
      .getByRole("group", { name: "Current signers", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("group", { name: "Reviewer accounts", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
  expect(await commands(page)).toEqual([]);
});

test("runtime modes retain separate drafts and a successful save clears only its own draft", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup#setup`);
  await page.getByLabel("Workspace name").fill("Local draft");
  await page
    .getByRole("button", { name: "Network and readiness", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Environment", exact: true })
    .getByRole("button", { name: /^DEMO/ })
    .click();
  await page
    .getByLabel("Native WebSocket endpoint", { exact: true })
    .fill("wss://test-node-v3.portaldot.dev");
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.getByText("RPC connected", { exact: true })).toBeVisible();
  await backToSetup(page);
  await expect(page.getByLabel("Workspace name")).toHaveValue("");
  await fillTeam(page, "Testnet draft");
  const demo = await teamValues(page);
  await connection(page, true, "LOCAL");
  await expect(page.getByLabel("Workspace name")).toHaveValue("Local draft");
  await connection(page, true, "DEMO");
  expect(await teamValues(page)).toEqual(demo);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/#overview$/);
  await page
    .getByRole("button", { name: "Create a new workspace", exact: true })
    .click();
  await expect(page.getByLabel("Workspace name")).toHaveValue("");
  await expect(
    page
      .getByRole("group", { name: "Current signers", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Reviewer accounts", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Funder account", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Create multisig", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", {
      name: "Add account to Current signers",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", {
      name: "Add account to Reviewer accounts",
      exact: true,
    }),
  ).toHaveValue("");
  await connection(page, true, "LOCAL");
  await expect(page.getByLabel("Workspace name")).toHaveValue("Local draft");
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "connect-network",
    "create-workspace",
  ]);
});

test("a rejected workspace save keeps the draft across route changes", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=fresh-setup&mode=DEMO&reject=create-workspace#setup`,
  );
  await fillTeam(page, "Rejected save draft");
  const before = await teamValues(page);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic create-workspace failure",
  );
  await expect(page).toHaveURL(/#setup$/);
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await page
    .getByRole("button", { name: "Create a new workspace", exact: true })
    .click();
  expect(await teamValues(page)).toEqual(before);
  expect((await commands(page)).map((command) => command.type)).toEqual([
    "create-workspace",
  ]);
});

test("checking and reconnecting never claim RPC online or allow saving a previously verified draft", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup&mode=DEMO#setup`);
  await fillTeam(page, "Editable interrupted draft");
  const before = await teamValues(page);
  const header = page.getByRole("button", {
    name: "Network and readiness",
    exact: true,
  });
  const save = page.getByRole("button", {
    name: "Create workspace",
    exact: true,
  });
  await networkState(page, {
    connected: true,
    checking: true,
    reconnecting: false,
  });
  await expect(header).toContainText("Checking network…");
  await expect(header).not.toContainText("RPC online");
  await expect(page.getByLabel("Workspace name")).toBeEditable();
  await expect(save).toBeDisabled();
  await networkState(page, {
    connected: false,
    checking: true,
    reconnecting: true,
    retryable: true,
  });
  await expect(header).toContainText("Reconnecting…");
  await expect(header).not.toContainText("RPC online");
  await expect(page.getByLabel("Workspace name")).toBeEditable();
  await expect(save).toBeDisabled();
  await page.getByLabel("Workspace name").fill("Edited while reconnecting");
  await connection(page, true);
  expect(await teamValues(page)).toEqual({
    ...before,
    name: "Edited while reconnecting",
  });
  await expect(header).toContainText("RPC online");
  await expect(save).toBeEnabled();
  expect(await commands(page)).toEqual([]);
});

for (const width of [320, 390]) {
  test(`${width}px visibly communicates connection progress and recovery without overflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${harness}?scenario=setup-checking&mode=DEMO#setup`);
    const status = page.locator(".header-network__state");
    await expect(status).toBeVisible();
    await expect(status).toHaveText("Connecting…");
    await connection(page, true);
    await expect(status).toHaveText("RPC online");
    await networkState(page, { checking: true });
    await expect(status).toHaveText("Checking network…");
    await networkState(page, {
      connected: false,
      checking: true,
      reconnecting: true,
    });
    await expect(status).toHaveText("Reconnecting…");
    await expect(page.getByLabel("Workspace name")).toBeEditable();
    await expect(status).toBeInViewport();
    expect(
      await status.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`reconnecting-${width}.png`),
      fullPage: false,
    });
    expect(await commands(page)).toEqual([]);
  });
}

test("nonretryable verification failure gates first use and offers manual review without an automatic command", async ({
  page,
}) => {
  await page.goto(
    `${harness}?scenario=setup-verification-error&mode=DEMO#setup`,
  );
  await expectGate(page);
  await expect(
    page.getByRole("button", { name: "Network and readiness", exact: true }),
  ).toContainText("Verification required");
  await expect(
    page.getByText("Synthetic runtime verification failure", { exact: true }),
  ).toBeVisible();
  await openNetwork(page);
  await backToSetup(page);
  await expectGate(page);
  expect(await commands(page)).toEqual([]);
});

test("a later nonretryable failure keeps the draft editable while saving remains blocked", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=fresh-setup&mode=DEMO#setup`);
  await fillTeam(page, "Draft before verification failure");
  const before = await teamValues(page);
  await networkState(page, {
    connected: false,
    checking: false,
    reconnecting: false,
    retryable: false,
    error: "Synthetic runtime changed",
  });
  await expect(
    page.getByRole("button", { name: "Network and readiness", exact: true }),
  ).toContainText("Verification required");
  await expect(page.getByLabel("Workspace name")).toBeEditable();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeDisabled();
  expect(await teamValues(page)).toEqual(before);
  expect(await commands(page)).toEqual([]);
});

for (const [scenario, action] of [
  ["network-prepared-review", "Request signature"],
  ["network-signed-review", "Send signed operation"],
]) {
  test(`${action} stays blocked and unacknowledged across connection loss`, async ({
    page,
  }) => {
    await page.goto(
      `${harness}?scenario=${scenario}#review?action=GRC-ROTATION-ADD-M1`,
    );
    const button = page.getByRole("button", { name: action!, exact: true });
    await page.getByRole("checkbox").check();
    await expect(button).toBeEnabled();
    await networkState(page, {
      connected: false,
      checking: true,
      reconnecting: true,
      retryable: true,
    });
    await expect(button).toBeDisabled();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await connection(page, true);
    await expect(button).toBeDisabled();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    expect(await commands(page)).toEqual([]);
  });
}
