import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NativeConnection,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import { MaxRetryAttemptedError, NetworkDisconnectedError } from "dedot";
import * as wallets from "@account-handoff/wallet-adapter";
import type { Journal } from "@account-handoff/local-store";
import { Application } from "../../../apps/web/src/application/application";
import type {
  AppSnapshot,
  RuntimeMode,
} from "../../../apps/web/src/ui-contract";
import type {
  ChainView,
  PendingOperation,
} from "../../../apps/web/src/application/models";
import { DIGEST, HASH, profile } from "../../fixtures/core";

const reads = vi.hoisted(() => ({
  workspace: vi.fn(),
  descriptor: vi.fn(),
  profile: vi.fn(),
}));
vi.mock(
  "../../../apps/web/src/application/network-state",
  async (original) => ({
    ...(await original<
      typeof import("../../../apps/web/src/application/network-state")
    >()),
    readWorkspaceState: reads.workspace,
  }),
);
vi.mock("../../../apps/web/src/application/network-profile", () => ({
  readNetworkDescriptor: reads.descriptor,
  qualifiedProfile: reads.profile,
}));

const endpoint = "wss://unit-test.invalid/";
const fingerprint: NativeFingerprint = {
  genesis: HASH as `0x${string}`,
  specName: "test",
  specVersion: 1,
  transactionVersion: 1,
  metadataVersion: 14,
  metadataHash: HASH as `0x${string}`,
  metadataSha256: DIGEST,
  rawMetadata: "0x00",
  runtimeCodeHash: HASH as `0x${string}`,
  signedExtensions: [],
  runtimeApis: {},
  anchor: { hash: HASH as `0x${string}`, number: 10 },
  tokenDecimals: 12,
  tokenSymbol: "UNIT",
  ss58Prefix: 42,
};
interface Access {
  metadata: Journal;
  journal: Journal | null;
  connection: NativeConnection | null;
  chain: ChainView | null;
  pending: PendingOperation | null;
  recovery: unknown;
  operationView(): null;
  checkPending(id: string): Promise<PendingOperation>;
  state: AppSnapshot;
  stopNetworkObservers?(): void;
}
const applications: Access[] = [];
function connection(url = endpoint, mode: RuntimeMode = "DEMO") {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const api = {
    status: "connected",
    rpc: { chain_getBlockHash: vi.fn().mockResolvedValue(HASH) },
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      const listeners = handlers.get(event) ?? new Set();
      handlers.set(event, listeners);
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  };
  const emit = (event: string, ...args: unknown[]) => {
    if (["connected", "disconnected", "reconnecting"].includes(event))
      api.status = event;
    for (const listener of handlers.get(event) ?? []) listener(...args);
  };
  const native = {
    endpoint: url,
    mode,
    api,
    fingerprint: vi.fn().mockResolvedValue(fingerprint),
    close: vi.fn(async () => emit("disconnected")),
    send: vi.fn(),
  };
  return {
    native: native as unknown as NativeConnection,
    read: native.fingerprint,
    close: native.close,
    send: native.send,
    genesis: api.rpc.chain_getBlockHash,
    emit,
    handlers,
  };
}
async function application() {
  const app = await Application.create();
  const access = app as unknown as Access;
  applications.push(access);
  return { app, access };
}
beforeEach(async () => {
  reads.workspace.mockReset().mockResolvedValue({
    accounts: {},
    grant: null,
    history: null,
    baselineChanged: false,
  });
  reads.descriptor.mockReset().mockResolvedValue(null);
  reads.profile.mockReset().mockResolvedValue(await profile());
});
afterEach(async () => {
  for (const access of applications.splice(0)) {
    access.stopNetworkObservers?.();
    await access.metadata.setPreference("network-connection", null);
    await access.metadata.setPreference("recovery", null);
    if (access.journal !== access.metadata) access.journal?.close();
    access.metadata.close();
  }
});

describe("native connection lifecycle", () => {
  it.each(["connect", "refresh"] as const)(
    "shows a clear transport error consistently after a wrapped browser event during %s",
    async (phase) => {
      const c = connection();
      const connect = vi
        .spyOn(NativeConnection, "connect")
        .mockResolvedValue(c.native);
      const { app } = await application();
      const cause = new Error("[object Event]");
      if (phase === "refresh") {
        await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
        c.read.mockRejectedValueOnce(cause);
      } else connect.mockRejectedValueOnce(cause);
      const error = await app
        .dispatch(
          phase === "connect"
            ? { type: "connect-network", mode: "DEMO", endpoint }
            : { type: "refresh" },
        )
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(NetworkDisconnectedError);
      expect((error as Error).cause).toBe(cause);
      expect((error as Error).message).toContain("Could not reach the network");
      expect(app.getSnapshot().network).toMatchObject({
        retryable: true,
        error: (error as Error).message,
      });
      expect(app.getSnapshot().notice?.message).toBe((error as Error).message);
    },
  );

  it("shows a clear error for a browser socket error event", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    c.emit("error", new Event("error"));
    expect(app.getSnapshot().network).toMatchObject({
      retryable: true,
      connected: false,
    });
    expect(app.getSnapshot().network.error).toContain(
      "Could not reach the network",
    );
  });

  it("invalidates fresh authority on a socket loss and revalidates only after API ready", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    expect(app.getSnapshot().network.connected).toBe(true);
    c.emit("disconnected");
    expect(app.getSnapshot().network.connected).toBe(false);
    expect(access.chain).toBeNull();
    expect(
      app
        .getSnapshot()
        .network.readiness.every(
          (item) => item.id === "wallet" || item.status === "unknown",
        ),
    ).toBe(true);
    c.emit("connected");
    expect(app.getSnapshot().network.connected).toBe(false);
    expect(c.read).toHaveBeenCalledTimes(1);
    c.emit("ready");
    await vi.waitFor(() =>
      expect(app.getSnapshot().network.connected).toBe(true),
    );
    expect(c.read).toHaveBeenCalledTimes(2);
  });

  it("does not publish an in-flight finalized read after its transport was lost", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    let finish!: (value: NativeFingerprint) => void;
    c.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refreshing = app.dispatch({ type: "refresh" });
    c.emit("disconnected");
    finish(fingerprint);
    await refreshing;
    expect(app.getSnapshot().network.connected).toBe(false);
    expect(access.chain).toBeNull();
  });

  it("rejects a new transport whose fresh genesis differs from the SDK's retained fingerprint", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    c.genesis.mockResolvedValue(`0x${"ff".repeat(32)}`);
    c.emit("ready");
    await vi.waitFor(() => expect(app.getSnapshot().busy).toBeNull());
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      retryable: false,
    });
    expect(app.getSnapshot().network.error).toContain("genesis");
    expect(access.chain).toBeNull();
    await expect(app.dispatch({ type: "refresh" })).rejects.toThrow("genesis");
    expect(app.getSnapshot().network.connected).toBe(false);
  });

  it("restores a successfully verified public endpoint as configuration without restoring readiness", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const first = await application();
    await first.app.dispatch({
      type: "connect-network",
      mode: "DEMO",
      endpoint,
    });
    const second = await application();
    expect(second.app.getSnapshot().network).toMatchObject({
      mode: "DEMO",
      endpoint,
      connected: false,
      checking: false,
      readiness: [],
    });
    expect(second.access.connection).toBeNull();
    expect(second.access.chain).toBeNull();
  });

  it("queues one ready refresh after the running command and suppresses its obsolete failure", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const sign = vi.spyOn(wallets, "requestSignature");
    const send = vi.spyOn(NativeConnection.prototype, "send");
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    let fail!: (error: Error) => void;
    c.read.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const refreshing = app.dispatch({ type: "refresh" });
    c.emit("ready");
    c.emit("ready");
    c.emit("ready");
    expect(c.read).toHaveBeenCalledTimes(2);
    fail(new Error("Obsolete runtime mismatch"));
    await refreshing;
    await vi.waitFor(() => expect(app.getSnapshot().busy).toBeNull());
    expect(c.read).toHaveBeenCalledTimes(3);
    expect(app.getSnapshot().network).toMatchObject({
      connected: true,
      reconnecting: false,
      retryable: false,
      error: null,
    });
    expect(app.getSnapshot().notice).toBeUndefined();
    expect(sign).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("makes a prepared review stale but retains signed bytes and unresolved recovery on loss", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    access.operationView = () => null;
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    const pending = {
      stage: "prepared",
      blockers: [],
      signedBytes: null,
    } as unknown as PendingOperation;
    access.pending = pending;
    c.emit("disconnected");
    expect(pending.stage).toBe("stale");
    const signed = {
      stage: "signed",
      blockers: [],
      signedBytes: "0x0400",
    } as unknown as PendingOperation;
    const recovery = { id: "retained", stage: "signed" };
    access.pending = signed;
    access.recovery = recovery;
    c.emit("reconnecting");
    expect(access.pending).toBe(signed);
    expect(signed).toMatchObject({ stage: "signed", signedBytes: "0x0400" });
    expect(access.recovery).toBe(recovery);
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      retryable: true,
      reconnecting: true,
    });
  });

  it("keeps a policy failure nonretryable when later provider errors or disconnects arrive", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    c.read.mockRejectedValueOnce(
      new Error("Native runtime differs from the immutable metadata binding"),
    );
    c.emit("ready");
    await vi.waitFor(() => expect(app.getSnapshot().busy).toBeNull());
    expect(app.getSnapshot().network.retryable).toBe(false);
    c.emit("disconnected");
    c.emit("error", new MaxRetryAttemptedError("SDK retries exhausted"));
    c.emit("reconnecting");
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      retryable: false,
      reconnecting: false,
      error: "Native runtime differs from the immutable metadata binding",
    });
    const count = c.read.mock.calls.length;
    c.emit("ready");
    c.emit("runtimeUpgraded");
    expect(c.read).toHaveBeenCalledTimes(count);
    expect(app.getSnapshot().network.retryable).toBe(false);
  });

  it("exposes SDK exhaustion as retryable without replacing the connection from an event handler", async () => {
    const c = connection();
    const connect = vi
      .spyOn(NativeConnection, "connect")
      .mockResolvedValue(c.native);
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    c.emit("disconnected");
    c.emit("error", new MaxRetryAttemptedError("SDK retries exhausted"));
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      checking: false,
      reconnecting: false,
      retryable: true,
    });
    expect(connect).toHaveBeenCalledOnce();
  });

  it("replaces a stopped connection even if its close rejects, and ignores detached events", async () => {
    const old = connection();
    const next = connection("wss://replacement.invalid/");
    const connect = vi
      .spyOn(NativeConnection, "connect")
      .mockResolvedValueOnce(old.native)
      .mockResolvedValueOnce(next.native);
    const { app, access } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    const obsoleteReady = [...old.handlers.get("ready")!][0]!;
    const obsoleteError = [...old.handlers.get("error")!][0]!;
    old.emit("disconnected");
    old.close.mockRejectedValueOnce(
      new Error("Websocket connection does not exist"),
    );
    await app.dispatch({
      type: "connect-network",
      mode: "DEMO",
      endpoint: next.native.endpoint,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(access.connection).toBe(next.native);
    expect(
      [...old.handlers.values()].every((listeners) => !listeners.size),
    ).toBe(true);
    old.emit("error", new Error("Obsolete failure"));
    old.emit("ready");
    obsoleteReady();
    obsoleteError(new Error("Detached callback raced with cleanup"));
    expect(app.getSnapshot().network).toMatchObject({
      endpoint: next.native.endpoint,
      connected: true,
      error: null,
    });
    expect(next.read).toHaveBeenCalledOnce();
  });

  it("keeps the last verified time visible on the same target, clearing it for another target", async () => {
    const first = connection();
    const second = connection();
    const third = connection("wss://other.invalid/");
    vi.spyOn(NativeConnection, "connect")
      .mockResolvedValueOnce(first.native)
      .mockResolvedValueOnce(second.native)
      .mockResolvedValueOnce(third.native);
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    const last = app.getSnapshot().network.updatedAt;
    let finish!: (value: NativeFingerprint) => void;
    second.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reconnecting = app.dispatch({
      type: "connect-network",
      mode: "DEMO",
      endpoint,
    });
    await vi.waitFor(() => expect(second.read).toHaveBeenCalledOnce());
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      updatedAt: last,
      blockNumber: "10",
    });
    finish(fingerprint);
    await reconnecting;
    third.read.mockRejectedValueOnce(
      new NetworkDisconnectedError("Lost connection"),
    );
    await expect(
      app.dispatch({
        type: "connect-network",
        mode: "DEMO",
        endpoint: third.native.endpoint,
      }),
    ).rejects.toThrow("Lost connection");
    expect(app.getSnapshot().network.updatedAt).toBeUndefined();
    expect(app.getSnapshot().network.blockNumber).toBeUndefined();
  });

  it("keeps a verified transport available when saving its public preference fails", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    const save = vi
      .spyOn(access.metadata, "setPreference")
      .mockRejectedValueOnce(
        new DOMException("Disk full", "QuotaExceededError"),
      );
    await expect(
      app.dispatch({ type: "connect-network", mode: "DEMO", endpoint }),
    ).rejects.toThrow("Disk full");
    expect(app.getSnapshot().network).toMatchObject({
      connected: true,
      checking: false,
      retryable: false,
      error: "Disk full",
    });
    expect(access.connection).toBe(c.native);
    expect(access.chain).not.toBeNull();
    expect(c.close).not.toHaveBeenCalled();
    c.emit("ready");
    expect(c.read).toHaveBeenCalledOnce();
    expect(app.getSnapshot().network.error).toBe("Disk full");
    save.mockRestore();
  });

  it("allows another DEMO endpoint but retains the LOCAL descriptor endpoint pin", async () => {
    reads.descriptor.mockResolvedValue({
      mode: "DEMO",
      nativeRpc: "wss://configured.invalid/",
    });
    const remote = connection();
    const local = connection("ws://localhost:9944/", "LOCAL");
    vi.spyOn(NativeConnection, "connect")
      .mockResolvedValueOnce(remote.native)
      .mockResolvedValueOnce(local.native);
    const { app } = await application();
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    expect(app.getSnapshot().network.connected).toBe(true);
    reads.descriptor.mockResolvedValue({
      mode: "LOCAL",
      nativeRpc: "ws://127.0.0.1:9944/",
      qualified: false,
    });
    await expect(
      app.dispatch({
        type: "connect-network",
        mode: "LOCAL",
        endpoint: local.native.endpoint,
      }),
    ).rejects.toThrow("endpoint does not match");
    expect(app.getSnapshot().network).toMatchObject({
      connected: false,
      retryable: false,
    });
  });

  it("clears the matching old connection notice after success and preserves an unrelated notice", async () => {
    const c = connection();
    const connect = vi
      .spyOn(NativeConnection, "connect")
      .mockRejectedValueOnce(new MaxRetryAttemptedError("Cannot reconnect"));
    const { app, access } = await application();
    await expect(
      app.dispatch({ type: "connect-network", mode: "DEMO", endpoint }),
    ).rejects.toThrow("Cannot reconnect");
    expect(app.getSnapshot().network.retryable).toBe(true);
    expect(app.getSnapshot().notice?.message).toBe("Cannot reconnect");
    connect.mockResolvedValue(c.native);
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    expect(app.getSnapshot().notice).toBeNull();
    const unrelated = {
      id: "signature-notice",
      tone: "negative" as const,
      message: "Wallet request was refused",
    };
    access.state = { ...access.state, notice: unrelated };
    await app.dispatch({ type: "refresh" });
    expect(app.getSnapshot().notice).toBe(unrelated);
  });

  it("retains the exact signed packet without broadcasting if transport changes during its saved checkpoint", async () => {
    const c = connection();
    vi.spyOn(NativeConnection, "connect").mockResolvedValue(c.native);
    const { app, access } = await application();
    access.operationView = () => null;
    await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
    const pending = {
      id: "packet",
      workspaceId: "workspace",
      actionId: "fund",
      title: "Funding",
      stage: "signed",
      blockers: [],
      signedBytes: "0x0400",
      signedAttempt: null,
      envelope: { recordId: "envelope" },
      context: {},
      signer: "signer",
    } as unknown as PendingOperation;
    access.pending = pending;
    access.journal = access.metadata;
    vi.spyOn(access, "checkPending").mockResolvedValue(pending);
    const save = access.metadata.setPreference.bind(access.metadata);
    vi.spyOn(access.metadata, "setPreference").mockImplementation(
      async (key, value) => {
        await save(key, value);
        if (
          key === "recovery" &&
          (value as { stage?: string } | null)?.stage === "broadcast"
        )
          c.emit("disconnected");
      },
    );
    await expect(
      app.dispatch({ type: "send-operation", id: pending.id }),
    ).rejects.toThrow("network changed");
    expect(c.send).not.toHaveBeenCalled();
    expect(pending).toMatchObject({ stage: "signed", signedBytes: "0x0400" });
    expect(await access.metadata.getPreference("recovery")).toMatchObject({
      stage: "signed",
    });
  });
});
