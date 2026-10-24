import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NativeMetadataBinding } from "@account-handoff/native-adapter";
import type { LocalRole } from "./browser-wallet";

interface FixtureManifest {
  mode: "LOCAL";
  runId: string;
  generation: number;
  genesisHash: string;
  endpoint: string;
  input: {
    name: string;
    beneficiary: string;
    contract: `0x${string}`;
    grantId: string;
    oldMembers: string[];
    newMembers: string[];
    funder: string;
  };
}
export const runId = process.env["AH_LOCAL_BROWSER_RUN"] ?? "browser";
const directory = resolve(".local-state", runId);
export function readFixture(): {
  contents: string;
  fixture: FixtureManifest;
  binding: NativeMetadataBinding;
} {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId))
    throw new Error("Invalid LOCAL browser runId");
  const contents = readFileSync(resolve(directory, "workspace.json"), "utf8");
  const fixture = JSON.parse(contents) as FixtureManifest;
  if (fixture.mode !== "LOCAL" || fixture.runId !== runId)
    throw new Error("Expected an explicitly seeded LOCAL browser fixture");
  const url = new URL(fixture.endpoint);
  if (
    url.protocol !== "ws:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Browser integration refuses nonlocal RPC");
  const binding = JSON.parse(
    readFileSync(resolve(directory, "native-metadata-binding.json"), "utf8"),
  ) as NativeMetadataBinding;
  if (binding.genesis !== fixture.genesisHash)
    throw new Error(
      "Browser test decoder binding differs from its LOCAL workspace",
    );
  return { contents, fixture, binding };
}
export async function connectNetworkAndWallet(page: Page, endpoint: string) {
  await page.goto("/#network");
  await page.getByLabel("Native WebSocket endpoint").fill(endpoint);
  await page
    .getByRole("button", { name: "Connect and verify", exact: true })
    .click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByLabel("Personal account")).toBeVisible();
}
export async function connectAndImport(
  page: Page,
  contents: string,
  endpoint: string,
) {
  await connectNetworkAndWallet(page, endpoint);
  await page
    .getByRole("button", { name: "Workspace data", exact: true })
    .click();
  await page.getByLabel("Or paste JSON").fill(contents);
  await page
    .getByRole("button", { name: "Verify and import", exact: true })
    .click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`LOCAL ${runId}`) }),
  ).toBeVisible();
}
export async function performApproval(
  page: Page,
  role: LocalRole,
  address: string,
  actionId: string,
  fields: Record<string, string> = {},
) {
  await test.step(`${role}: ${actionId}`, async () => {
    await page.getByLabel("Personal account").selectOption(address);
    await page.evaluate((id) => {
      window.location.hash = `review?action=${encodeURIComponent(id)}`;
    }, actionId);
    const discard = page.getByRole("button", {
      name: "Set review aside",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    for (const [label, value] of Object.entries(fields)) {
      const input = page.getByLabel(label, { exact: true });
      if ((await input.evaluate((element) => element.tagName)) === "SELECT")
        await input.selectOption(value);
      else await input.fill(value);
    }
    await page
      .getByRole("button", { name: "Prepare for review", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Request signature", exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Request signature", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Send signed operation",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", {
        name: "Send signed operation",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Send signed operation",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(discard).toBeVisible();
    // The native receipt is separately asserted by the caller. This wait only gates the next explicit review.
    await expect(page.locator(".activity-indicator")).toHaveCount(0);
  });
}
export async function captureActualWorkspace(
  page: Page,
  testInfo: TestInfo,
  prefix: string,
) {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1050 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const [route, label] of [
      ["overview", "Overview"],
      ["history", "History"],
      ["team", "Team"],
    ] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `${route} ${viewport.name} must not overflow horizontally`,
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${prefix}-${route}-${viewport.name}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
}
