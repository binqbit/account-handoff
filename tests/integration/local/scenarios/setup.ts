import { expect, test } from "@playwright/test";
import {
  NativeConnection,
  account,
  contractAddress,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import { injectLocalWallet } from "../browser-wallet";
import {
  readFixture,
  runId,
  connectNetworkAndWallet,
  performApproval,
  captureActualWorkspace,
} from "../browser-support";

export function registerSetupScenarios() {
  test("creates a separate Pure and grant through UI funding, mapping, submission and reviewer approval", async ({
    page,
  }, testInfo) => {
    test.setTimeout(900000);
    const { fixture, binding } = readFixture();
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
      for (const role of ["F2", "R1_2", "R2_2"] as const) {
        const state = await connection.readAccount(wallet.accounts[role]);
        expect(state.mappedTo, `${role} must begin without mapping`).toBeNull();
      }
      await connectNetworkAndWallet(page, fixture.endpoint);
      await page.getByLabel("Personal account").selectOption(wallet.accounts.A);
      await page.getByRole("button", { name: /Workspaces/ }).click();
      await page
        .getByRole("button", { name: "New workspace", exact: true })
        .click();
      await page.getByLabel("Workspace name").fill(`LOCAL ${runId} UI setup`);
      await page
        .getByLabel("Original group M0 — three addresses")
        .fill(
          [wallet.accounts.A, wallet.accounts.B, wallet.accounts.C].join("\n"),
        );
      await page
        .getByLabel("New group M1 — three addresses")
        .fill(
          [wallet.accounts.A, wallet.accounts.B, wallet.accounts.D].join("\n"),
        );
      await page.getByLabel("Funder account F").fill(wallet.accounts.F2);
      await page
        .getByLabel("Two reviewer accounts")
        .fill([wallet.accounts.R1_2, wallet.accounts.R2_2].join("\n"));
      await page
        .getByRole("button", { name: "Save team", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: `Setup: LOCAL ${runId} UI setup`,
          exact: true,
        }),
      ).toBeVisible();
      const fingerprint = await connection.fingerprint();
      const amountLabel = `Amount (${fingerprint.tokenSymbol})`;
      await performApproval(page, "A", wallet.accounts.A, "GRC-SETUP-FUND-M0", {
        [amountLabel]: "50",
      });
      for (const recipientRole of ["F", "R1", "R2"])
        await performApproval(
          page,
          "A",
          wallet.accounts.A,
          "GRC-SETUP-FUND-ACTOR",
          { Recipient: recipientRole, [amountLabel]: "100" },
        );
      for (const role of ["A", "B"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-SETUP-CREATE-PURE",
          { "Pure index": "1" },
        );
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      const beneficiaryCard = page.locator(".card").filter({
        has: page.getByRole("heading", {
          name: "Grant beneficiary",
          exact: true,
        }),
      });
      const pure = (
        await beneficiaryCard.locator(".identity .address").innerText()
      ).trim();
      expect(pure).toMatch(/^0x[0-9a-f]{64}$/);
      expect(pure).not.toBe(fixture.input.beneficiary);
      const initial = await connection.readAccount(pure);
      expect(initial.proxies).toHaveLength(1);
      const m0 = initial.proxies[0]!.delegate;
      await performApproval(page, "A", wallet.accounts.A, "GRC-SETUP-FUND-P", {
        [amountLabel]: "100",
      });
      for (const role of ["A", "B"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-SETUP-MAP-P",
        );
      expect((await connection.readAccount(pure)).mappedTo).toBe(account(pure));
      for (const [role, actorRole] of [
        ["F2", "F"],
        ["R1_2", "R1"],
        ["R2_2", "R2"],
      ] as const) {
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-SETUP-MAP-ACTOR",
          { "Direct participant": actorRole },
        );
        expect(
          (await connection.readAccount(wallet.accounts[role])).mappedTo,
        ).toBe(wallet.accounts[role]);
      }
      await performApproval(
        page,
        "F2",
        wallet.accounts.F2,
        "GRC-GRANT-CREATE",
        {
          "Deployed Vestry contract address": fixture.input.contract,
          [`First tranche (${fingerprint.tokenSymbol})`]: "18",
          [`Second tranche (${fingerprint.tokenSymbol})`]: "12",
          "First tranche vesting: blocks": "1800",
          "Milestone deadline: days from preparation": "7",
        },
      );
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      const grantLabel = await page
        .getByText(/Grant #\d+.*milestones/)
        .innerText();
      const grantId = BigInt(grantLabel.match(/Grant #(\d+)/)![1]!);
      expect(grantId).not.toBe(BigInt(fixture.input.grantId));
      let grant = await readGrant(
        connection,
        wallet.accounts.F2,
        fixture.input.contract,
        grantId,
      );
      expect(grant.grantee).toBe(contractAddress(pure));
      expect(grant.funder).toBe(contractAddress(wallet.accounts.F2));
      expect(grant.milestones.map((milestone) => milestone.state)).toEqual([
        0, 0,
      ]);
      for (const role of ["A", "B"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-GRANT-SUBMIT-M0",
          {
            "Public evidence":
              "LOCAL UI setup: original controller submits the first milestone",
          },
        );
      for (const [index, role] of (["R1_2", "R2_2"] as const).entries()) {
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-GRANT-APPROVE",
          { "Milestone under review": "0" },
        );
        grant = await readGrant(
          connection,
          wallet.accounts.F2,
          fixture.input.contract,
          grantId,
        );
        expect(grant.milestones[0]!.approvals).toBe(index + 1);
        expect(grant.milestones[0]!.state).toBe(index === 0 ? 1 : 2);
      }
      expect((await connection.readAccount(pure)).frozen).toBeGreaterThan(0n);
      for (const role of ["A", "B"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-ROTATION-ADD-M1",
        );
      const dual = await connection.readAccount(pure);
      expect(dual.proxies).toHaveLength(2);
      const m1 = dual.proxies.find((proxy) => proxy.delegate !== m0)!.delegate;
      for (const role of ["A", "D"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-ROTATION-REMOVE-M0",
        );
      expect((await connection.readAccount(pure)).proxies).toEqual([
        { delegate: m1, proxyType: "Any", delay: 0 },
      ]);
      for (const role of ["A", "D"] as const)
        await performApproval(
          page,
          role,
          wallet.accounts[role],
          "GRC-GRANT-SUBMIT-M1",
          {
            "Public evidence":
              "LOCAL UI setup: the new controller continues the same grant",
          },
        );
      grant = await readGrant(
        connection,
        wallet.accounts.F2,
        fixture.input.contract,
        grantId,
      );
      expect(grant.milestones[1]!.state).toBe(1);
      expect(wallet.requests).toHaveLength(23);
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(page.getByText("Continued", { exact: true })).toBeVisible();
      await testInfo.attach("setup-native-wallet-request-identities", {
        body: JSON.stringify(wallet.requests, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({
        path: testInfo.outputPath("ui-created-workspace-continued.png"),
        fullPage: true,
      });
      await captureActualWorkspace(page, testInfo, "ui-created-continued");
    } finally {
      await connection.close();
    }
  });
}
