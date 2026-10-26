import { test, expect } from "@playwright/test";
import {
  NativeConnection,
  account,
  contractAddress,
} from "@account-handoff/native-adapter";
import { readGrant } from "@account-handoff/grant-adapter";
import { readFileSync, writeFileSync } from "node:fs";
import { buildBlocks } from "./blocks";
import { injectLocalWallet } from "../local/browser-wallet";
import {
  performApproval,
  selectPersonalAccount,
} from "../local/browser-support";
const binding = JSON.parse(
  readFileSync("infra/testnet/metadata-binding.json", "utf8"),
);
const network = JSON.parse(readFileSync("infra/testnet/network.json", "utf8"));
test("complete DEMO application on the exact PortalDot runtime fork", async ({
  page,
}, testInfo) => {
  const c = await NativeConnection.connect(
    "ws://127.0.0.1:8059",
    "LOCAL",
    binding,
  );
  try {
    await c.api.provider.send("dev_setBlockBuildMode", ["Instant"]);
    await page.addInitScript(
      ({ remote, local }) => {
        const Real = window.WebSocket;
        window.WebSocket = class extends Real {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(
              new URL(String(url)).host === new URL(remote).host ? local : url,
              protocols,
            );
          }
        };
      },
      { remote: network.nativeRpc, local: "ws://127.0.0.1:8059" },
    );
    const w = await injectLocalWallet(page, c, "http://127.0.0.1:44174");
    await page.goto("/#network");
    await page
      .getByRole("button", { name: "Connect and verify", exact: true })
      .click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await selectPersonalAccount(page, w.accounts.F);
    await page.getByRole("button", { name: /Workspaces/ }).click();
    await page
      .getByRole("button", { name: "New workspace", exact: true })
      .click();
    await page
      .getByLabel("Workspace name")
      .fill("PortalDot fork five-role flow");
    for (const [label, addresses] of [
      ["Current signers", [w.accounts.A, w.accounts.B, w.accounts.C]],
      ["Reviewer accounts", [w.accounts.B, w.accounts.F]],
    ] as const) {
      for (const address of addresses) {
        const input = page.getByRole("combobox", {
          name: `Add account to ${label}`,
          exact: true,
        });
        await input.fill(address);
        await input.press("Enter");
      }
    }
    await page
      .getByRole("combobox", { name: "Funder account", exact: true })
      .fill(w.accounts.F);
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "PortalDot fork five-role flow",
        exact: true,
      }),
    ).toBeVisible();
    const fingerprint = await c.fingerprint(),
      symbol = fingerprint.tokenSymbol;
    const saveCheckpoint = async (stage: string) => {
      await page.context().storageState({
        path: testInfo.outputPath("checkpoint.storage.json"),
        indexedDB: true,
      });
      writeFileSync(
        testInfo.outputPath("checkpoint.json"),
        JSON.stringify({ stage, walletRequests: w.requests }, null, 2) + "\n",
      );
    };
    const act = async (
      role: "A" | "B" | "C" | "D" | "F",
      id: string,
      fields = {},
    ) => {
      await performApproval(page, role, w.accounts[role], id, fields);
      await saveCheckpoint(`${role}:${id}`);
    };
    await act("F", "GRC-SETUP-FUND-M0", { [`Amount (${symbol})`]: "3" });
    for (const role of ["A", "B"] as const)
      await act(role, "GRC-SETUP-CREATE-PURE", {
        "Pure index": String(fingerprint.anchor.number % 65536),
      });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const card = page.locator(".card").filter({
      has: page.getByRole("heading", {
        name: "Grant beneficiary",
        exact: true,
      }),
    });
    await card
      .locator(".identity")
      .getByRole("button", { name: "Show full address", exact: true })
      .click();
    const pure = account(
      (await card.locator(".identity .address-full code").innerText()).trim(),
    );
    const m0 = (await c.readAccount(pure)).proxies[0]!.delegate;
    await act("F", "GRC-SETUP-FUND-P", { [`Amount (${symbol})`]: "6" });
    expect((await c.readAccount(pure)).mappedTo).toBe(pure);
    await act("F", "GRC-GRANT-CREATE", {
      "Deployed Vestry contract address": network.contractAddress,
      [`First tranche (${symbol})`]: "10",
      [`Second tranche (${symbol})`]: "0.1",
      "First tranche vesting: blocks": "200",
      "Milestone deadline: days from preparation": "7",
    });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    const label = await page.getByText(/Grant #\d+.*milestones/).innerText();
    const grantId = BigInt(label.match(/Grant #(\d+)/)![1]!);
    for (const role of ["A", "B"] as const)
      await act(role, "GRC-GRANT-SUBMIT-M0", {
        "Public evidence": "Original team delivery",
      });
    for (const role of ["B", "F"] as const)
      await act(role, "GRC-GRANT-APPROVE", { "Milestone under review": "0" });
    const handoff = async (members: string[], another = false) => {
      await page
        .getByRole("button", { name: "Control handoff", exact: true })
        .click();
      if (another)
        await page
          .getByRole("button", { name: "Start another handoff", exact: true })
          .click();
      const group = page.getByRole("group", {
        name: "Replacement signers",
        exact: true,
      });
      for (let i = 0; i < 2; i++)
        await group
          .getByRole("button", { name: /^Remove / })
          .first()
          .click();
      for (const address of members) {
        const field = page.getByRole("combobox", {
          name: "Add account to Replacement signers",
          exact: true,
        });
        await field.fill(address);
        await field.press("Enter");
      }
      await page
        .getByRole("button", { name: "Prepare handoff", exact: true })
        .click();
    };
    await handoff([w.accounts.A, w.accounts.B, w.accounts.D]);
    for (const role of ["A", "B"] as const)
      await act(role, "GRC-ROTATION-ADD-M1");
    for (const role of ["A", "D"] as const)
      await act(role, "GRC-ROTATION-REMOVE-M0");
    for (const role of ["A", "D"] as const)
      await act(role, "GRC-GRANT-SUBMIT-M1", {
        "Public evidence": "Replacement team delivery",
      });
    await page.reload();
    await page.goto("/#network");
    await page
      .getByRole("button", { name: "Connect and verify", exact: true })
      .click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await selectPersonalAccount(page, w.accounts.F);
    await c.api.provider.send("dev_setBlockBuildMode", ["Manual"]);
    const schedules = (await c.readAccount(pure)).vesting as {
      locked: string;
      perBlock: string;
      startingBlock: number;
    }[];
    expect(schedules).toHaveLength(1);
    const schedule = schedules[0]!;
    const end =
      BigInt(schedule.startingBlock) +
      (BigInt(schedule.locked) + BigInt(schedule.perBlock) - 1n) /
        BigInt(schedule.perBlock);
    const height = BigInt((await c.fingerprint()).anchor.number);
    const count = Number(end > height ? end - height : 1n);
    await saveCheckpoint("before-vesting-wait");
    await buildBlocks(count);
    await c.api.provider.send("dev_setBlockBuildMode", ["Instant"]);
    await act("F", "GRC-VESTING-VEST-OTHER");
    await handoff([w.accounts.A, w.accounts.B, w.accounts.C], true);
    for (const role of ["A", "B"] as const)
      await act(role, "GRC-ROTATION-ADD-M1");
    for (const role of ["A", "C"] as const)
      await act(role, "GRC-ROTATION-REMOVE-M0");
    for (const role of ["B", "F"] as const)
      await act(role, "GRC-GRANT-APPROVE", { "Milestone under review": "1" });
    const grant = await readGrant(c, pure, network.contractAddress, grantId),
      state = await c.readAccount(pure);
    expect(grant.grantee).toBe(contractAddress(pure));
    expect(grant.milestones.map((m) => m.state)).toEqual([2, 2]);
    expect(state.frozen).toBe(0n);
    expect(state.vesting).toEqual([]);
    expect(state.proxies.map((p) => p.delegate)).toEqual([m0]);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("completed.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        status: "PASSED",
        pure,
        grantId: String(grantId),
        signatures: w.requests.length,
      }),
    );
  } finally {
    await c.close();
  }
});
