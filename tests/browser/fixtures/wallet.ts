import { expect, type Page } from "@playwright/test";
export const walletAccounts = [`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`];
export interface WalletProbe {
  events: string[];
  emit: (addresses: string[]) => void;
}

/** Public-account injection for the real application; all signing is rejected. */
export async function installWallet(page: Page) {
  await page.addInitScript(
    ({ addresses }) => {
      const events: string[] = [];
      const listeners = new Set<
        (accounts: { address: string; name: string; type: string }[]) => void
      >();
      let current = localStorage.getItem("test-wallet-missing-account")
        ? addresses.slice(0, 1)
        : addresses;
      const items = () =>
        current.map((address, index) => ({
          address,
          name: index ? "Test Bob" : "Test Alice",
          type: "sr25519",
        }));
      Object.defineProperty(window, "__walletProbe", {
        value: {
          events,
          emit(values: string[]) {
            current = values;
            listeners.forEach((listener) => listener(items()));
          },
        },
      });
      const provider = (source: string) => ({
        version: "test-only",
        async enable() {
          events.push(`enable:${source}`);
          return {
            accounts: {
              async get() {
                events.push(`get:${source}`);
                return items();
              },
              subscribe(
                callback: (accounts: ReturnType<typeof items>) => void,
              ) {
                events.push(`subscribe:${source}`);
                listeners.add(callback);
                return () => {
                  events.push(`unsubscribe:${source}`);
                  listeners.delete(callback);
                };
              },
            },
            signer: {
              async signPayload() {
                events.push("sign");
                throw new Error("This wallet fixture never signs");
              },
            },
          };
        },
      });
      window.injectedWeb3 = {};
      if (localStorage.getItem("test-wallet-extra"))
        window.injectedWeb3.unrelated = provider("unrelated");
      if (!localStorage.getItem("test-wallet-unavailable")) {
        const inject = () => {
          window.injectedWeb3!.saved = provider("saved");
        };
        if (localStorage.getItem("test-wallet-delayed"))
          setTimeout(inject, 150);
        else inject();
      }
    },
    { addresses: walletAccounts },
  );
}
export async function connectWallet(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const selected = page.getByLabel("Personal account", { exact: true });
  await expect(selected).toBeVisible();
  await selected.selectOption(walletAccounts[1]!);
  await expect(selected).toBeEnabled();
}
export async function walletEvents(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __walletProbe: WalletProbe }).__walletProbe
        .events,
  );
}
