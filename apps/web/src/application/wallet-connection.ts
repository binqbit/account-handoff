import {
  connectWallets,
  type WalletSession,
  type WalletAccount,
} from "@account-handoff/wallet-adapter";
import type { Journal } from "@account-handoff/local-store";
import type { AppSnapshot } from "../ui-contract";
import { errorText } from "./values";

export const WALLET_PREFERENCE = "wallet-connection";
export interface WalletPreference {
  version: 1;
  sources: string[];
  selected: { source: string; address: string } | null;
}
type WalletState = AppSnapshot["wallet"];
const disconnected = (): WalletState => ({
  connected: false,
  connecting: false,
  accounts: [],
  selectedAddress: null,
  source: null,
});

export function readWalletPreference(value: unknown): WalletPreference | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WalletPreference>;
  if (
    record.version !== 1 ||
    !Array.isArray(record.sources) ||
    !record.sources.length ||
    record.sources.length > 20 ||
    !record.sources.every(
      (source) =>
        typeof source === "string" && source.length > 0 && source.length <= 128,
    ) ||
    new Set(record.sources).size !== record.sources.length
  )
    return null;
  const selected = record.selected;
  if (
    selected !== null &&
    (!selected ||
      !record.sources.includes(selected.source) ||
      typeof selected.address !== "string" ||
      !/^0x[0-9a-f]{64}$/.test(selected.address))
  )
    return null;
  return {
    version: 1,
    sources: [...record.sources],
    selected: selected
      ? { source: selected.source, address: selected.address }
      : null,
  };
}

/** Owns wallet discovery and public preferences; never invokes a signing method. */
export class WalletConnection {
  private state = disconnected();
  private sessions: WalletSession[] = [];
  private subscriptions: (() => void)[] = [];
  private generation = 0;
  private preference: WalletPreference | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: Pick<Journal, "setPreference">,
    private readonly changed: (
      state: WalletState,
      sessions: WalletSession[],
      reason?: string,
    ) => void,
    private readonly discover = connectWallets,
  ) {}

  private publish(state: WalletState, reason?: string) {
    this.state = state;
    this.changed(state, this.sessions, reason);
  }
  private stopSubscriptions() {
    for (const stop of this.subscriptions.splice(0)) {
      try {
        stop();
      } catch {
        /* Generation fencing also disables a provider's late callbacks. */
      }
    }
  }
  private save(value: WalletPreference | null): Promise<void> {
    const next = this.writes
      .catch(() => {})
      .then(() => this.storage.setPreference(WALLET_PREFERENCE, value));
    this.writes = next;
    return next;
  }
  private remember(): Promise<void> {
    this.preference = {
      version: 1,
      sources: this.sessions.map((session) => session.source),
      selected:
        this.state.selectedAddress && this.state.source
          ? { source: this.state.source, address: this.state.selectedAddress }
          : null,
    };
    return this.save(this.preference);
  }
  private accounts(): WalletAccount[] {
    return this.sessions.flatMap((session) => session.accounts);
  }
  private acceptAccounts(
    session: WalletSession,
    accounts: WalletAccount[],
    generation: number,
  ) {
    if (generation !== this.generation) return;
    session.accounts = accounts;
    const available = this.accounts();
    const selected = available.find(
      (account) =>
        account.address === this.state.selectedAddress &&
        account.source === this.state.source,
    );
    const missing = !!this.state.selectedAddress && !selected;
    this.publish(
      {
        ...this.state,
        accounts: available,
        selectedAddress: selected?.address ?? null,
        source: selected?.source ?? null,
        error: !available.length
          ? "No signing accounts are shared. Unlock your wallet or allow an account."
          : missing
            ? "The selected account is no longer available. Choose an account from your wallet."
            : null,
      },
      "The available wallet accounts changed",
    );
    void this.remember().catch((error) => {
      if (generation === this.generation)
        this.publish({
          ...this.state,
          error: `Could not remember the wallet connection: ${errorText(error)}`,
        });
    });
  }

  async restore(preference: WalletPreference): Promise<void> {
    this.preference = preference;
    try {
      await this.open(true);
    } catch {
      /* The wallet state reports restoration failures; the rest of the app remains usable. */
    }
  }
  async connect(): Promise<void> {
    await this.open(false);
  }

  private async open(restoring: boolean): Promise<void> {
    const generation = ++this.generation;
    this.stopSubscriptions();
    this.sessions = [];
    this.publish(
      { ...disconnected(), connecting: true },
      "Wallet connection changed",
    );
    try {
      const sessions = await this.discover(
        restoring && this.preference
          ? { sources: this.preference.sources, waitForInjectionMs: 2000 }
          : {},
      );
      if (generation !== this.generation) return;
      if (!sessions.length) throw new Error("No native wallets are connected");
      this.sessions = sessions;
      const accounts = this.accounts();
      const wanted = this.preference?.selected;
      const selected =
        wanted &&
        accounts.find(
          (account) =>
            account.address === wanted.address &&
            account.source === wanted.source,
        );
      this.publish({
        connected: true,
        connecting: true,
        accounts,
        selectedAddress: selected?.address ?? null,
        source: selected?.source ?? null,
        ...(!accounts.length
          ? {
              error:
                "No signing accounts are shared. Unlock your wallet or allow an account.",
            }
          : wanted && !selected
            ? {
                error:
                  "The previous account is unavailable. Select an account to continue.",
              }
            : {}),
      });
      for (const session of sessions) {
        const stop = await session.subscribe((items) =>
          this.acceptAccounts(session, items, generation),
        );
        if (generation !== this.generation) {
          stop();
          return;
        }
        this.subscriptions.push(stop);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.stopSubscriptions();
        this.sessions = [];
        this.publish({ ...disconnected(), error: errorText(error) });
      }
      throw error;
    } finally {
      if (generation === this.generation)
        this.publish({ ...this.state, connecting: false });
    }
    if (generation === this.generation) {
      try {
        await this.remember();
      } catch (error) {
        this.publish({
          ...this.state,
          error: `Could not remember the wallet connection: ${errorText(error)}`,
        });
        throw error;
      }
    }
  }

  async select(address: string): Promise<void> {
    const account =
      this.accounts().find(
        (item) => item.address === address && item.source === this.state.source,
      ) ?? this.accounts().find((item) => item.address === address);
    if (!account)
      throw new Error("This account is not available in the connected wallet");
    this.publish(
      {
        connected: true,
        connecting: false,
        accounts: this.accounts(),
        selectedAddress: account.address,
        source: account.source,
      },
      "Signer changed; review the operation again",
    );
    await this.remember();
  }

  async disconnect(): Promise<void> {
    this.generation++;
    this.stopSubscriptions();
    this.sessions = [];
    this.preference = null;
    this.publish(disconnected(), "Wallet disconnected");
    await this.save(null);
  }
}
