import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Journal } from "@account-handoff/local-store";
import testnet from "../../../infra/testnet/network.json";

const journals: Journal[] = [];
afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function start(mode: string) {
  vi.stubEnv("MODE", mode);
  vi.resetModules();
  const { Application } =
    await import("../../../apps/web/src/application/application");
  const app = await Application.create();
  const access = app as unknown as { metadata: Journal; chain: unknown };
  journals.push(access.metadata);
  return { app, access };
}

describe("testnet deployment boundary", () => {
  it("does not attach an existing beneficiary before network qualification", async () => {
    const { app, access } = await start("testnet");
    access.chain = {
      fingerprint: { genesis: testnet.genesisHash },
      profile: { status: "candidate" },
    };
    const id = (n: number) => `0x${String(n).repeat(64)}`;
    await expect(
      app.dispatch({
        type: "create-workspace",
        input: {
          name: "Unqualified import",
          oldMembers: [id(1), id(2), id(3)],
          threshold: 2,
          funder: id(4),
          reviewers: [id(5), id(6)],
          beneficiary: id(7),
        },
      }),
    ).rejects.toThrow("Qualify the network");
    expect(app.getSnapshot().workspaces).toEqual([]);
  });
  it("starts the real coordinator in an isolated testnet journal without connecting", async () => {
    const { openJournal } = await import("@account-handoff/local-store");
    const local = await openJournal("account-handoff:local:ui");
    journals.push(local);
    await local.setPreference("currentId", "local-only-record");

    const { app, access } = await start("testnet");
    expect(access.metadata.namespace).toBe(
      "account-handoff:demo:portaldot-v3:ui",
    );
    expect(await access.metadata.getPreference("currentId")).toBeUndefined();
    expect(app.getSnapshot()).toMatchObject({
      network: {
        mode: "DEMO",
        name: testnet.name,
        endpoint: testnet.nativeRpc,
        connected: false,
      },
      wallet: { connected: false, selectedAddress: null },
      workspace: null,
      workspaces: [],
      operation: null,
    });
    expect(access.chain).toBeNull();
  });

  it("rejects LOCAL and LIVE commands in the coordinator, before opening a connection", async () => {
    const { app } = await start("testnet");
    const { NativeConnection } =
      await import("@account-handoff/native-adapter");
    const connect = vi.spyOn(NativeConnection, "connect");
    for (const mode of ["LOCAL", "LIVE"] as const)
      await expect(
        app.dispatch({
          type: "connect-network",
          mode,
          endpoint: testnet.nativeRpc,
        }),
      ).rejects.toThrow("only to PortalDot V3 testnet");
    expect(connect).not.toHaveBeenCalled();
    expect(app.getSnapshot().network.mode).toBe("DEMO");
  });

  it("closes a remote endpoint with the wrong genesis and retains no usable chain", async () => {
    const { app, access } = await start("testnet");
    const { NativeConnection } =
      await import("@account-handoff/native-adapter");
    const close = vi.fn(async () => {});
    vi.spyOn(NativeConnection, "connect").mockResolvedValue({
      close,
      fingerprint: async () => ({ genesis: `0x${"11".repeat(32)}` }),
    } as unknown as Awaited<ReturnType<typeof NativeConnection.connect>>);
    await expect(
      app.dispatch({
        type: "connect-network",
        mode: "DEMO",
        endpoint: testnet.nativeRpc,
      }),
    ).rejects.toThrow("not the configured PortalDot V3 testnet");
    expect(close).toHaveBeenCalledOnce();
    expect(access.chain).toBeNull();
    expect(app.getSnapshot().network.connected).toBe(false);
  });

  it("keeps the existing default LOCAL configuration", async () => {
    const { app, access } = await start("production");
    expect(access.metadata.namespace).toBe("account-handoff:local:ui");
    expect(app.getSnapshot().network).toMatchObject({
      mode: "LOCAL",
      endpoint: "ws://127.0.0.1:9944",
      connected: false,
    });
  });
});
