import { afterEach, expect, it, vi } from "vitest";
import { DedotClient, WsProvider } from "dedot";
import { NativeConnection } from "@account-handoff/native-adapter";

afterEach(() => vi.restoreAllMocks());

it("closes the provider when initial SDK connection fails", async () => {
  vi.spyOn(DedotClient, "legacy").mockRejectedValue(
    new Error("Initial RPC timed out"),
  );
  const disconnect = vi
    .spyOn(WsProvider.prototype, "disconnect")
    .mockResolvedValue(undefined);
  await expect(
    NativeConnection.connect("wss://rpc.example.invalid", "DEMO"),
  ).rejects.toThrow("Initial RPC timed out");
  expect(disconnect).toHaveBeenCalledOnce();
});
