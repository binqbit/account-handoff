import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Journal } from "@account-handoff/local-store";
import testnet from "../../../infra/testnet/network.json";
import type {
  ApplicationFacade,
  AppSnapshot,
} from "../../../apps/web/src/ui-contract";

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
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "testnet");
  entry.createApplication.mockReset();
  entry.createRoot.mockReset().mockReturnValue({ render: entry.render });
  entry.render.mockReset();
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  journals.splice(0).forEach((journal) => journal.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function startup() {
  return (await import("../../../apps/web/src/application/startup-connection"))
    .connectTestnetAtStartup;
}
function harness() {
  const listeners = new Set<() => void>();
  const snapshot: AppSnapshot = {
    revision: 0,
    network: {
      mode: "DEMO",
      name: "Testnet",
      endpoint: testnet.nativeRpc,
      connected: false,
      checking: false,
      readiness: [],
    },
    wallet: {
      connected: false,
      connecting: false,
      selectedAddress: null,
      accounts: [],
    },
    workspaces: [],
    workspace: null,
    actions: [],
    operation: null,
    busy: null,
  };
  const dispatch = vi
    .fn<ApplicationFacade["dispatch"]>()
    .mockResolvedValue(undefined);
  const application: ApplicationFacade = {
    dispatch,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    application,
    snapshot,
    dispatch,
    emit: () => listeners.forEach((fn) => fn()),
  };
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
  it("restores the chosen endpoint and backs off transient failures without concurrent attempts", async () => {
    vi.useFakeTimers();
    const { application, snapshot, dispatch, emit } = harness();
    snapshot.network.endpoint = "wss://alternate.example/";
    dispatch.mockImplementation(async () => {
      snapshot.network.retryable = true;
      emit();
      throw new Error("Transient failure");
    });
    cleanups.push((await startup())(application));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "connect-network",
      mode: "DEMO",
      endpoint: "wss://alternate.example/",
    });
    for (const delay of [2_000, 5_000, 10_000, 30_000, 30_000]) {
      const previous = dispatch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(dispatch).toHaveBeenCalledTimes(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(dispatch).toHaveBeenCalledTimes(previous + 1);
    }
    expect(
      dispatch.mock.calls.every(
        ([command]) => command.type === "connect-network",
      ),
    ).toBe(true);
  });

  it("waits for SDK reconnects and active commands, then resets backoff after verified recovery", async () => {
    vi.useFakeTimers();
    const { application, snapshot, dispatch, emit } = harness();
    let finish!: () => void;
    dispatch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    cleanups.push((await startup())(application));
    snapshot.network.retryable = true;
    emit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
    snapshot.network.reconnecting = true;
    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
    snapshot.network.reconnecting = false;
    snapshot.busy = "sign";
    emit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
    snapshot.busy = null;
    snapshot.network.connected = true;
    snapshot.network.retryable = false;
    emit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
    snapshot.network.connected = false;
    snapshot.network.retryable = true;
    emit();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("suspends while offline, resumes on online, and cleans up listeners and pending retries", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const navigator = { onLine: false };
    vi.stubGlobal("window", events);
    vi.stubGlobal("navigator", navigator);
    const { application, snapshot, dispatch, emit } = harness();
    dispatch.mockImplementation(async () => {
      snapshot.network.retryable = true;
    });
    const stop = (await startup())(application);
    cleanups.push(stop);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).not.toHaveBeenCalled();
    navigator.onLine = true;
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledOnce();
    navigator.onLine = false;
    events.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
    navigator.onLine = true;
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledTimes(2);
    stop();
    emit();
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("cancels a retry if manual validation finds a permanent failure", async () => {
    vi.useFakeTimers();
    const { application, snapshot, dispatch, emit } = harness();
    dispatch.mockImplementation(async () => {
      snapshot.network.retryable = true;
    });
    cleanups.push((await startup())(application));
    await vi.advanceTimersByTimeAsync(0);
    snapshot.network.retryable = false;
    snapshot.network.error = "Wrong genesis";
    emit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("dispatches one connection to the configured testnet without waiting for it", async () => {
    const connect = await startup();
    let finish!: () => void;
    const { application, dispatch } = harness();
    dispatch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    cleanups.push(connect(application));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "connect-network",
      mode: "DEMO",
      endpoint: testnet.nativeRpc,
    });
    finish();
    await dispatch.mock.results[0]!.value;
  });

  it.each(["development", "production", "live"])(
    "does not connect wallets or networks in a %s build",
    async (mode) => {
      vi.stubEnv("MODE", mode);
      const connect = await startup();
      const { application, dispatch } = harness();
      cleanups.push(connect(application));
      expect(dispatch).not.toHaveBeenCalled();
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

    cleanups.push((await startup())(application));
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
    // An unclassified failure is not retried automatically; manual retry remains available.
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
    const { application, dispatch } = harness();
    dispatch.mockImplementation(() => {
      expect(entry.render).toHaveBeenCalledOnce();
      return Promise.reject(new Error("Read-only connection failed"));
    });
    entry.createApplication.mockResolvedValue(application);
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
