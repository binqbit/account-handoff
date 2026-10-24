import { AccountId32 } from "dedot/codecs";
import type { Injection, InjectedAccount, WalletSession } from "./types";

export interface ConnectWalletOptions {
  /** Reconnection must not ask unrelated extensions for access. */
  sources?: readonly string[];
  waitForInjectionMs?: number;
}

async function providersFor(
  options: ConnectWalletOptions,
): Promise<[string, Injection][]> {
  const wait = options.waitForInjectionMs ?? 0;
  if (!Number.isFinite(wait) || wait < 0 || wait > 5000)
    throw new Error("Wallet discovery timeout is outside the supported range");
  const deadline = Date.now() + wait;
  const sources = options.sources ? new Set(options.sources) : null;
  while (true) {
    const providers = Object.entries(window.injectedWeb3 ?? {}).filter(
      ([source]) => !sources || sources.has(source),
    );
    if (
      Date.now() >= deadline ||
      (sources ? providers.length === sources.size : providers.length > 0)
    )
      return providers;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(50, deadline - Date.now())),
    );
  }
}

export async function connectWallets(
  options: ConnectWalletOptions = {},
): Promise<WalletSession[]> {
  const providers = await providersFor(options);
  if (!providers.length)
    throw new Error(
      options.sources
        ? "The previously connected wallet is unavailable. Open or unlock it, then connect again."
        : "Install a supported native wallet such as SubWallet, then allow Account Handoff to access the signer accounts.",
    );
  const sessions: WalletSession[] = [];
  const errors: string[] = [];
  for (const [source, provider] of providers) {
    try {
      const enabled = await provider.enable("Account Handoff");
      if (!enabled.signer.signPayload)
        throw new Error("Signature-only native payload signing is unavailable");
      const normalize = (items: InjectedAccount[]) =>
        items.map((item) => ({
          ...item,
          address: new AccountId32(item.address).raw,
          source,
        }));
      sessions.push({
        source,
        version: provider.version ?? "unknown",
        accounts: normalize(await enabled.accounts.get()),
        signPayload: enabled.signer.signPayload.bind(enabled.signer),
        subscribe: async (callback) =>
          enabled.accounts.subscribe
            ? enabled.accounts.subscribe((items) => callback(normalize(items)))
            : () => {},
      });
    } catch (error) {
      errors.push(
        `${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!sessions.length)
    throw new Error(
      errors.join("; ") || "No native signing accounts were authorized",
    );
  return sessions;
}
