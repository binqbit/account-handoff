import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Journal } from "@account-handoff/local-store";
import testnet from "../../../infra/testnet/network.json";

const entry = vi.hoisted(() => ({
  createApplication: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn(),
}));
vi.mock("../../../apps/web/src/application/application", async (original) => ({
  ...(await original<
    typeof import("../../../apps/web/src/application/application")
  >()),
  createApplication: entry.createApplication,
}));
vi.mock("react-dom/client", () => ({ createRoot: entry.createRoot }));
vi.mock("../../../apps/web/src/App", () => ({ App: () => null }));

const journals: Journal[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "testnet");
  entry.createApplication.mockReset();
  entry.createRoot.mockReset().mockReturnValue({ render: entry.render });
  entry.render.mockReset();
});
afterEach(() => {
  journals.splice(0).forEach((journal) => journal.close());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function startup() {
  return (await import("../../../apps/web/src/application/startup-connection"))
    .connectTestnetAtStartup;
}
function documentHarness() {
  const root = { replaceChildren: vi.fn(), append: vi.fn() };
  const message = { textContent: "" };
  vi.stubGlobal("document", {
    getElementById: vi.fn().mockReturnValue(root),
    createElement: vi.fn().mockReturnValue(message),
  });
  return { root, message };
}

describe("read-only testnet startup", () => {
  it("dispatches one connection to the configured testnet without waiting for it", async () => {
    const connect = await startup();
    let finish!: () => void;
    const application = {
      dispatch: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    expect(connect(application)).toBeUndefined();
    expect(application.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "connect-network",
      mode: "DEMO",
      endpoint: testnet.nativeRpc,
    });
    finish();
    await application.dispatch.mock.results[0]!.value;
  });

  it.each(["development", "production", "live"])(
    "does not connect wallets or networks in a %s build",
    async (mode) => {
      vi.stubEnv("MODE", mode);
      const connect = await startup();
      const application = { dispatch: vi.fn().mockResolvedValue(undefined) };
      connect(application);
      expect(application.dispatch).not.toHaveBeenCalled();
    },
  );

  it("handles a failed real coordinator connection while preserving its visible error and manual retry", async () => {
    const { Application } =
      await import("../../../apps/web/src/application/application");
    const { NativeConnection } =
      await import("@account-handoff/native-adapter");
    const wallets = await import("@account-handoff/wallet-adapter");
    const connect = vi
      .spyOn(NativeConnection, "connect")
      .mockRejectedValue(new Error("Testnet RPC unavailable"));
    const discover = vi.spyOn(wallets, "connectWallets");
    const sign = vi.spyOn(wallets, "requestSignature");
    const send = vi.spyOn(NativeConnection.prototype, "send");
    const application = await Application.create();
    journals.push((application as unknown as { metadata: Journal }).metadata);
    const dispatch = vi.spyOn(application, "dispatch");

    (await startup())(application);
    expect(application.getSnapshot().busy).toBe("connect-network");
    await vi.waitFor(() =>
      expect(application.getSnapshot().network.error).toBe(
        "Testnet RPC unavailable",
      ),
    );
    expect(application.getSnapshot()).toMatchObject({
      network: { connected: false, checking: false },
      wallet: { connected: false, selectedAddress: null, accounts: [] },
      operation: null,
      busy: null,
      notice: { tone: "negative", message: "Testnet RPC unavailable" },
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "connect-network",
      mode: "DEMO",
      endpoint: testnet.nativeRpc,
    });
    expect(discover).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // A later explicit connection command remains available; startup never retries it.
    await expect(
      application.dispatch({
        type: "connect-network",
        mode: "DEMO",
        endpoint: testnet.nativeRpc,
      }),
    ).rejects.toThrow("Testnet RPC unavailable");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("renders the application before starting the connection and keeps it rendered on failure", async () => {
    const { root } = documentHarness();
    const dispatch = vi.fn(() => {
      expect(entry.render).toHaveBeenCalledOnce();
      return Promise.reject(new Error("Read-only connection failed"));
    });
    entry.createApplication.mockResolvedValue({ dispatch });
    await import("../../../apps/web/src/main");
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    // Let the rejected startup promise and its handler complete this event-loop turn.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(entry.render).toHaveBeenCalledOnce();
    expect(root.replaceChildren).not.toHaveBeenCalled();
    expect(root.append).not.toHaveBeenCalled();
  });

  it("preserves the journal-open error and does not start a connection without an application", async () => {
    const { root, message } = documentHarness();
    entry.createApplication.mockRejectedValue(
      new Error("Journal is unavailable"),
    );
    await import("../../../apps/web/src/main");
    await vi.waitFor(() => expect(root.append).toHaveBeenCalledWith(message));
    expect(message.textContent).toBe(
      "Could not open the local journal: Journal is unavailable",
    );
    expect(entry.createRoot).not.toHaveBeenCalled();
  });
});
