import { afterEach, describe, expect, it, vi } from "vitest";
import { connectWallets } from "@account-handoff/wallet-adapter";
import { encodeAddress } from "@polkadot/util-crypto";

const address = `0x${"12".repeat(32)}`;
function provider() {
  const unsubscribe = vi.fn();
  const signPayload = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  return {
    enable: vi.fn(async () => ({
      accounts: {
        get: async () => [
          { address: encodeAddress(address, 42), name: "Alice" },
        ],
        subscribe,
      },
      signer: { signPayload },
    })),
    subscribe,
    signPayload,
    unsubscribe,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("native wallet connection", () => {
  it("reconnects only the saved providers and supports synchronous unsubscribe handles", async () => {
    const saved = provider(),
      other = provider();
    vi.stubGlobal("window", { injectedWeb3: { saved, other } });
    const sessions = await connectWallets({ sources: ["saved"] });
    expect(saved.enable).toHaveBeenCalledOnce();
    expect(other.enable).not.toHaveBeenCalled();
    expect(sessions[0]!.accounts).toEqual([
      { address, name: "Alice", source: "saved" },
    ]);
    const stop = await sessions[0]!.subscribe(vi.fn());
    stop();
    expect(saved.unsubscribe).toHaveBeenCalledOnce();
    expect(saved.signPayload).not.toHaveBeenCalled();
  });
  it("waits for delayed extension injection before authorizing once", async () => {
    vi.useFakeTimers();
    const saved = provider();
    const window = {} as {
      injectedWeb3?: Record<string, ReturnType<typeof provider>>;
    };
    vi.stubGlobal("window", window);
    const connecting = connectWallets({
      sources: ["saved"],
      waitForInjectionMs: 500,
    });
    setTimeout(() => {
      window.injectedWeb3 = { saved };
    }, 100);
    await vi.advanceTimersByTimeAsync(150);
    expect((await connecting)[0]!.source).toBe("saved");
    expect(saved.enable).toHaveBeenCalledOnce();
  });
  it("never falls back to a newly installed provider when the saved one is missing", async () => {
    const other = provider();
    vi.stubGlobal("window", { injectedWeb3: { other } });
    await expect(connectWallets({ sources: ["missing"] })).rejects.toThrow(
      "previously connected wallet",
    );
    expect(other.enable).not.toHaveBeenCalled();
  });
});
