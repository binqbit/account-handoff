import { expect, test } from "@playwright/test";
import {
  connectWallet,
  installWallet,
  walletAccounts,
  walletEvents,
  type WalletProbe,
} from "./fixtures/wallet";

test.beforeEach(async ({ page }) => installWallet(page));

test("first visit does not request wallet access", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
  expect(await walletEvents(page)).toEqual([]);
});

test("reload restores the exact source and account without contacting a new wallet or signing", async ({
  page,
}) => {
  await connectWallet(page);
  await page.evaluate(() => localStorage.setItem("test-wallet-extra", "1"));
  await page.reload();
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toHaveValue(walletAccounts[1]!);
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toBeEnabled();
  expect(await walletEvents(page)).toEqual([
    "enable:saved",
    "get:saved",
    "subscribe:saved",
  ]);
  const stored = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const opening = indexedDB.open("account-handoff:local:ui");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const read = db
            .transaction("preferences")
            .objectStore("preferences")
            .get("wallet-connection");
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
        };
      }),
  );
  expect(stored).toEqual({
    version: 1,
    sources: ["saved"],
    selected: { source: "saved", address: walletAccounts[1] },
  });
});

test("disconnect persists across reload and cancels automatic reconnection", async ({
  page,
}) => {
  await connectWallet(page);
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
  expect(await walletEvents(page)).toEqual([]);
});

test("a missing account is not replaced with a different signer", async ({
  page,
}) => {
  await connectWallet(page);
  await page.evaluate(() =>
    localStorage.setItem("test-wallet-missing-account", "1"),
  );
  await page.reload();
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText(
      "The previous account is unavailable. Select an account to continue.",
    ),
  ).toBeVisible();
  expect((await walletEvents(page)).includes("sign")).toBe(false);
});

test("delayed wallet injection still restores the selected account", async ({
  page,
}) => {
  await connectWallet(page);
  await page.evaluate(() => localStorage.setItem("test-wallet-delayed", "1"));
  await page.reload();
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toHaveValue(walletAccounts[1]!);
  expect(
    (await walletEvents(page)).filter((event) => event === "enable:saved"),
  ).toHaveLength(1);
});

test("an unavailable saved provider leaves the app usable without requesting unrelated access", async ({
  page,
}) => {
  await connectWallet(page);
  await page.evaluate(() => {
    localStorage.setItem("test-wallet-unavailable", "1");
    localStorage.setItem("test-wallet-extra", "1");
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/previously connected wallet is unavailable/),
  ).toBeVisible();
  expect(await walletEvents(page)).toEqual([]);
});

test("account updates revoke the old selection and cannot undo a disconnect", async ({
  page,
}) => {
  await connectWallet(page);
  await page.evaluate(
    (address) =>
      (window as unknown as { __walletProbe: WalletProbe }).__walletProbe.emit([
        address,
      ]),
    walletAccounts[0]!,
  );
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText(/selected account is no longer available/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeEnabled();
  await page.evaluate(
    (addresses) =>
      (window as unknown as { __walletProbe: WalletProbe }).__walletProbe.emit(
        addresses,
      ),
    walletAccounts,
  );
  await expect(
    page.getByLabel("Personal account", { exact: true }),
  ).toHaveCount(0);
  expect((await walletEvents(page)).includes("sign")).toBe(false);
});
