import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
const routes = [
  "home",
  "docs",
  "overview",
  "milestones",
  "team",
  "handoff",
  "history",
  "workspaces",
  "setup",
  "network",
  "data",
  "attention",
  "review",
];

for (const width of [320, 390, 768, 1440]) {
  test(`all destinations fit a ${width}px viewport without page errors`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      await page.goto(
        `${harness}#${route}${route === "review" ? "?action=GRC-ROTATION-ADD-M1" : ""}`,
      );
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route,
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

for (const [mode, label] of [
  ["LOCAL", "Local"],
  ["DEMO", "Testnet"],
  ["LIVE", "Mainnet"],
]) {
  test(`${label} remains visible in the mobile network control`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`${harness}?mode=${mode}#overview`);
    const network = page.getByRole("button", {
      name: "Network and readiness",
      exact: true,
    });
    await expect(network.getByText(label!, { exact: true })).toBeVisible();
  });
}

for (const scenario of ["unknown", "blocked-review", "cancellation"]) {
  test(`${scenario} does not show a contradictory all-clear state`, async ({
    page,
  }) => {
    await page.goto(`${harness}?scenario=${scenario}#attention`);
    await expect(
      page.getByRole("heading", {
        name: "No unresolved attempts found",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name:
          scenario === "cancellation" ? "Review cancellation" : "Open attempt",
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("network connection is distinct from transaction readiness", async ({
  page,
}) => {
  await page.goto(`${harness}#network`);
  await expect(page.getByText("RPC connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Transaction readiness", exact: true }),
  ).toBeVisible();
});

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

test("a disconnected linked grant keeps its identity while unread facts remain unavailable", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=disconnected-linked#overview`);
  await expect(
    page.getByText("Grant #0 · Milestone data unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Mapping not verified", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 milestones", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("Grant not linked yet", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Refresh the workspace to verify this grant's milestone state.",
      { exact: true },
    ),
  ).toBeVisible();
});
