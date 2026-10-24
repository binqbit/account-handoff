import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  NativeConnection,
  account,
  contractAddress,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import { injectLocalWallet } from "../browser-wallet";
import {
  readFixture,
  connectAndImport,
  performApproval,
  captureActualWorkspace,
} from "../browser-support";

export function registerHandoffScenarios() {
  test("loads the actual workspace, then A/B add, A/D remove and A/D continue through the website", async ({
    page,
  }, testInfo) => {
    const { contents, fixture, binding } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
      binding,
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
          { "Public evidence": evidence },
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
      await page.getByRole("button", { name: "History", exact: true }).click();
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
        page.getByRole("heading", { name: "An outcome you can verify" }),
      ).toBeVisible();
      await expect
        .poll(async () => page.locator(".activity-row").count())
        .toBeGreaterThanOrEqual(3);
      expect(wallet.requests).toHaveLength(6);
      await captureActualWorkspace(page, testInfo, "seeded-continued");
    } finally {
      await connection.close();
    }
  });
}
