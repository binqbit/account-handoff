import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { NativeConnection } from "@account-handoff/native-adapter";
import { injectLocalWallet } from "../browser-wallet";
import { readFixture, connectAndImport } from "../browser-support";

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
      await page.getByLabel("Personal account").selectOption(wallet.accounts.A);
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
}
