import { describe, expect, it, vi } from "vitest";
import {
  WalletConnection,
  readWalletPreference,
  type WalletPreference,
} from "../../../apps/web/src/application/wallet-connection";
import type {
  WalletAccount,
  WalletSession,
} from "@account-handoff/wallet-adapter";
import type { AppSnapshot } from "../../../apps/web/src/ui-contract";

const A = `0x${"1".repeat(64)}`,
  B = `0x${"2".repeat(64)}`;
function wallet(source = "saved", addresses = [A, B]) {
  let callback: ((accounts: WalletAccount[]) => void) | undefined;
  const stop = vi.fn();
  const session: WalletSession = {
    source,
    version: "test",
    accounts: addresses.map((address) => ({ address, source })),
    signPayload: vi.fn(),
    subscribe: async (listener) => {
      callback = listener;
      return stop;
    },
  };
  return {
    session,
    stop,
    emit: (addresses: string[]) =>
      callback?.(addresses.map((address) => ({ address, source }))),
  };
}
function harness(sessions: WalletSession[]) {
  let record: unknown;
  let state: AppSnapshot["wallet"] | undefined;
  const discover = vi.fn(async () => sessions);
  const storage = {
    setPreference: vi.fn(async (_key: string, value: unknown) => {
      record = structuredClone(value);
    }),
  };
  const changed = vi.fn((value: AppSnapshot["wallet"]) => {
    state = value;
  });
  const connection = new WalletConnection(storage, changed, discover);
  return {
    connection,
    discover,
    storage,
    changed,
    state: () => state!,
    record: () => record,
  };
}
const preference: WalletPreference = {
  version: 1,
  sources: ["saved"],
  selected: { source: "saved", address: B },
};

describe("persistent wallet context", () => {
  it("stores only public providers and selection, then restores the exact account", async () => {
    const w = wallet();
    const first = harness([w.session]);
    await first.connection.connect();
    expect(first.state().selectedAddress).toBeNull();
    await first.connection.select(B);
    expect(first.record()).toEqual(preference);
    const second = harness([wallet().session]);
    await second.connection.restore(readWalletPreference(first.record())!);
    expect(second.discover).toHaveBeenCalledWith({
      sources: ["saved"],
      waitForInjectionMs: 2000,
    });
    expect(second.state()).toMatchObject({
      connected: true,
      connecting: false,
      selectedAddress: B,
      source: "saved",
    });
    expect(w.session.signPayload).not.toHaveBeenCalled();
  });
  it("does not silently replace an unavailable account", async () => {
    const h = harness([wallet("saved", [A]).session]);
    await h.connection.restore(preference);
    expect(h.state()).toMatchObject({
      connected: true,
      selectedAddress: null,
      source: null,
    });
    expect(h.state().error).toContain("previous account is unavailable");
    expect(h.record()).toEqual({ ...preference, selected: null });
  });
  it("distinguishes the same public key exposed by different providers", async () => {
    const h = harness([
      wallet("other", [B]).session,
      wallet("saved", [B]).session,
    ]);
    await h.connection.restore({ ...preference, sources: ["other", "saved"] });
    expect(h.state().source).toBe("saved");
  });
  it("forgets the session on explicit disconnect and ignores obsolete account events", async () => {
    const w = wallet();
    const h = harness([w.session]);
    await h.connection.restore(preference);
    await h.connection.disconnect();
    w.emit([A]);
    expect(h.state()).toMatchObject({
      connected: false,
      selectedAddress: null,
      accounts: [],
    });
    expect(h.record()).toBeNull();
    expect(w.stop).toHaveBeenCalledOnce();
  });
  it("disconnect wins over a delayed restore", async () => {
    const h = harness([]);
    let resolve!: (sessions: WalletSession[]) => void;
    h.discover.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const restoring = h.connection.restore(preference);
    await h.connection.disconnect();
    resolve([wallet().session]);
    await restoring;
    expect(h.state().connected).toBe(false);
    expect(h.record()).toBeNull();
  });
  it("removes the selected account when the wallet withdraws it", async () => {
    const w = wallet();
    const h = harness([w.session]);
    await h.connection.restore(preference);
    w.emit([A]);
    expect(h.state().selectedAddress).toBeNull();
    await vi.waitFor(() =>
      expect(h.record()).toEqual({ ...preference, selected: null }),
    );
    expect(h.changed).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "The available wallet accounts changed",
    );
  });
  it("keeps the application usable when restoration fails", async () => {
    const h = harness([]);
    h.discover.mockRejectedValueOnce(new Error("Wallet is locked"));
    await h.connection.restore(preference);
    expect(h.state()).toMatchObject({
      connected: false,
      connecting: false,
      error: "Wallet is locked",
    });
    expect(h.storage.setPreference).not.toHaveBeenCalled();
  });
  it("rejects malformed preferences instead of requesting unrelated providers", () => {
    for (const value of [
      null,
      {},
      { ...preference, version: 2 },
      { ...preference, sources: ["saved", "saved"] },
      { ...preference, selected: { source: "other", address: B } },
      { ...preference, selected: { source: "saved", address: "seed words" } },
    ]) {
      expect(readWalletPreference(value)).toBeNull();
    }
  });
});
