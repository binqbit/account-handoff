import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { NativeConnection } from "@account-handoff/native-adapter";
import { injectLocalWallet } from "../browser-wallet";
import {
  readFixture,
  connectAndImport,
  selectPersonalAccount,
} from "../browser-support";

export function registerBaselineScenarios() {
  test("loads the real baseline across accessible task routes without signing", async ({
    page,
  }, testInfo) => {
    const { contents, fixture, binding } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
      binding,
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      const before = await connection.readAccount(fixture.input.beneficiary);
      await selectPersonalAccount(page, wallet.accounts.A);
      await selectPersonalAccount(page, wallet.accounts.B);
      expect(
        (await connection.readAccount(fixture.input.beneficiary)).proxies,
      ).toEqual(before.proxies);
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
    const { contents, fixture, binding } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
      binding,
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      const before = await connection.readAccount(fixture.input.beneficiary);
      await selectPersonalAccount(page, wallet.accounts.A);
      await page.evaluate(() => {
        window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
      });
      await page
        .getByRole("button", { name: "Prepare for review", exact: true })
        .click();
      await expect(page.getByRole("checkbox")).toBeVisible({ timeout: 45000 });
      await page.getByRole("checkbox").check();
      wallet.rejectNextRequest();
      await page
        .getByRole("button", { name: "Request signature", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "rejected the signature",
      );
      await expect(
        page.getByRole("button", {
          name: "Send signed operation",
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
  test("restores a signed review after reload while excluding a cloned tab", async ({
    page,
  }) => {
    const { contents, fixture, binding } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
      binding,
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      await selectPersonalAccount(page, wallet.accounts.A);
      const before = await connection.readAccount(wallet.accounts.A);
      await page.evaluate(() => {
        window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
      });
      await page
        .getByRole("button", { name: "Prepare for review", exact: true })
        .click();
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
      expect(wallet.requests).toHaveLength(1);
      const popupPromise = page.waitForEvent("popup");
      await page.evaluate(() => window.open("/#network", "_blank"));
      const otherTab = await popupPromise;
      const otherWallet = await injectLocalWallet(
        otherTab,
        connection,
        "http://127.0.0.1:4175",
      );
      await otherTab.reload();
      await otherTab
        .getByLabel("Native WebSocket endpoint")
        .fill(fixture.endpoint);
      await otherTab
        .getByRole("button", { name: "Connect and verify", exact: true })
        .click();
      await expect(
        otherTab.getByText("Connected", { exact: true }),
      ).toBeVisible();
      await otherTab.evaluate(() => {
        window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
      });
      await otherTab
        .getByRole("button", {
          name: "Restore the signed operation",
          exact: true,
        })
        .click();
      await expect(otherTab.getByRole("alert")).toContainText(
        "Another tab controls reconciliation.",
      );
      expect(otherWallet.requests).toHaveLength(0);
      await otherTab.close();
      await page.reload();
      await page
        .getByRole("button", { name: "Network and readiness", exact: true })
        .click();
      await page.getByLabel("Native WebSocket endpoint").fill(fixture.endpoint);
      await page
        .getByRole("button", { name: "Connect and verify", exact: true })
        .click();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = "review?action=GRC-ROTATION-ADD-M1";
      });
      await page
        .getByRole("button", {
          name: "Restore the signed operation",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Send signed operation",
          exact: true,
        }),
      ).toBeVisible();
      expect(wallet.requests).toHaveLength(1);
      expect((await connection.readAccount(wallet.accounts.A)).nonce).toBe(
        before.nonce,
      );
      // The restored packet remains unsubmitted: the test never sends it.
    } finally {
      await connection.close();
    }
  });
}
