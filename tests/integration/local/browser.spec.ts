/** Explicit real-native LOCAL integration, not part of the offline test command. */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NativeConnection,
  account,
  contractAddress,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import { injectLocalWallet, type LocalRole } from "./browser-wallet";

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
const runId = process.env["AH_LOCAL_BROWSER_RUN"] ?? "browser";
const directory = resolve(".local-state", runId);
function readFixture(): { contents: string; fixture: FixtureManifest } {
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
  return { contents, fixture };
}
async function connectAndImport(
  page: Page,
  contents: string,
  endpoint: string,
) {
  await page.goto("/#network");
  await page.getByLabel("Native WebSocket endpoint").fill(endpoint);
  await page
    .getByRole("button", { name: "Підключити та перевірити", exact: true })
    .click();
  await expect(page.getByText("Підключено", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Підключити гаманець", exact: true })
    .click();
  await expect(page.getByLabel("Особистий акаунт")).toBeVisible();
  await page
    .getByRole("button", { name: "Дані простору", exact: true })
    .click();
  await page.getByLabel("Або вставте JSON").fill(contents);
  await page
    .getByRole("button", { name: "Перевірити та імпортувати", exact: true })
    .click();
  await page.getByRole("button", { name: "Огляд", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`LOCAL ${runId}`) }),
  ).toBeVisible();
}
async function performApproval(
  page: Page,
  role: LocalRole,
  address: string,
  actionId: string,
  evidence?: string,
) {
  await page.getByLabel("Особистий акаунт").selectOption(address);
  await page.evaluate((id) => {
    window.location.hash = `review?action=${encodeURIComponent(id)}`;
  }, actionId);
  const discard = page.getByRole("button", {
    name: "Відкласти перегляд",
    exact: true,
  });
  if (await discard.isVisible()) await discard.click();
  if (evidence !== undefined)
    await page.getByLabel("Публічний доказ").fill(evidence);
  await page
    .getByRole("button", { name: "Підготувати до перегляду", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Запросити підпис", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Запросити підпис", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Надіслати підписану операцію",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Надіслати підписану операцію", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Надіслати підписану операцію",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(discard).toBeVisible();
  // The native receipt is separately asserted by the caller. This wait only gates the next explicit review.
  await expect(page.locator(".activity-indicator")).toHaveCount(0);
}

test.describe("real LOCAL website and native wallet boundary", () => {
  test.skip(
    process.env["AH_LOCAL_BROWSER"] !== "1",
    "Run explicitly with AH_LOCAL_BROWSER=1 after seeding a dedicated LOCAL baseline.",
  );
  test("loads the real baseline across accessible task routes without signing", async ({
    page,
  }, testInfo) => {
    const { contents, fixture } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      for (const route of [
        "overview",
        "milestones",
        "team",
        "history",
        "network",
        "data",
      ]) {
        await page.evaluate((value) => {
          window.location.hash = value;
        }, route);
        await expect(page.locator("h1")).toBeVisible();
        const report = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          report.violations.map((violation) => violation.id),
          route,
        ).toEqual([]);
      }
      expect(wallet.requests).toHaveLength(0);
      await page.evaluate(() => {
        window.location.hash = "overview";
      });
      await page.screenshot({
        path: testInfo.outputPath("baseline-actual-local.png"),
        fullPage: true,
      });
    } finally {
      await connection.close();
    }
  });
  test("explicit wallet rejection leaves the real native state unchanged", async ({
    page,
  }) => {
    const { contents, fixture } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      const before = await connection.readAccount(fixture.input.beneficiary);
      await page.getByLabel("Особистий акаунт").selectOption(wallet.accounts.A);
      await page.evaluate(() => {
        window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
      });
      await page
        .getByRole("button", { name: "Підготувати до перегляду", exact: true })
        .click();
      await page.getByRole("checkbox").check();
      wallet.rejectNextRequest();
      await page
        .getByRole("button", { name: "Запросити підпис", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("відхилив підпис");
      await expect(
        page.getByRole("button", {
          name: "Надіслати підписану операцію",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(wallet.requests).toHaveLength(0);
      expect(wallet.rejected).toEqual(["A"]);
      const after = await connection.readAccount(fixture.input.beneficiary);
      expect(after.proxies).toEqual(before.proxies);
    } finally {
      await connection.close();
    }
  });
  test("loads the actual workspace, then A/B add, A/D remove and A/D continue through the website", async ({
    page,
  }, testInfo) => {
    const { contents, fixture } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
    );
    try {
      const fingerprint = await connection.fingerprint();
      expect(fingerprint.genesis).toBe(fixture.genesisHash);
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      const initial = await connection.readAccount(fixture.input.beneficiary);
      expect(initial.proxies).toHaveLength(1);
      const m0 = initial.proxies[0]!.delegate;
      for (const role of ["A", "B"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-ROTATION-ADD-M1",
        );
      const dual = await connection.readAccount(fixture.input.beneficiary);
      expect(dual.proxies).toHaveLength(2);
      expect(
        dual.proxies.every(
          (proxy) => proxy.proxyType === "Any" && proxy.delay === 0,
        ),
      ).toBe(true);
      const m1 = dual.proxies.find((proxy) => proxy.delegate !== m0)!.delegate;
      for (const role of ["A", "D"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-ROTATION-REMOVE-M0",
        );
      const rotated = await connection.readAccount(fixture.input.beneficiary);
      expect(rotated.proxies).toEqual([
        { delegate: m1, proxyType: "Any", delay: 0 },
      ]);
      expect(rotated.mappedTo).toBe(account(fixture.input.beneficiary));
      const evidence =
        "LOCAL browser continuation: distinct A and D native wallet approvals";
      for (const role of ["A", "D"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-GRANT-SUBMIT-M1",
          evidence,
        );
      const grant = await readGrant(
        connection,
        fixture.input.funder,
        fixture.input.contract,
        BigInt(fixture.input.grantId),
      );
      expect(grant.grantee.toLowerCase()).toBe(
        contractAddress(fixture.input.beneficiary),
      );
      expect(grant.milestones[1]!.state).toBe(1);
      expect(wallet.requests.map((request) => request.role)).toEqual([
        "A",
        "B",
        "A",
        "D",
        "A",
        "D",
      ]);
      await page.getByRole("button", { name: "Історія", exact: true }).click();
      await expect(page.getByText("Continued", { exact: true })).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations).toEqual([]);
      await testInfo.attach("native-wallet-request-identities", {
        body: JSON.stringify(wallet.requests, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({
        path: testInfo.outputPath("continued-actual-local.png"),
        fullPage: true,
      });
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Результат, який можна перевірити" }),
      ).toBeVisible();
      await expect
        .poll(async () => page.locator(".activity-row").count())
        .toBeGreaterThanOrEqual(3);
      expect(wallet.requests).toHaveLength(6);
    } finally {
      await connection.close();
    }
  });
});
