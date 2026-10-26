import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "../../../packages/native-adapter/src/receipts";
import type {
  NativeConnection,
  NativeMetadataBinding,
} from "@account-handoff/native-adapter";

afterEach(() => vi.useRealTimers());
const binding = {} as NativeMetadataBinding;
const never = () => new Promise<never>(() => {});
function fixture(
  subscription: Promise<() => Promise<void>>,
  finality: Promise<unknown>,
) {
  const pending = Object.assign(subscription, {
    untilFinalized: () => finality,
  });
  const receipt = { canonical: true };
  const c = {
    fingerprint: vi.fn(async () => ({})),
    api: { sendTx: vi.fn(() => pending) },
    receiptAt: vi.fn(async () => receipt),
  };
  return { c, connection: c as unknown as NativeConnection, receipt };
}
describe("bounded native transaction observation", () => {
  it("propagates subscription rejection instead of hanging on an unsettled finality promise", async () => {
    const { connection, c } = fixture(
      Promise.reject(new Error("Pool rejected")),
      never(),
    );
    await expect(send(connection, binding, "0x00")).rejects.toThrow(
      "Pool rejected",
    );
    expect(c.api.sendTx).toHaveBeenCalledOnce();
  });
  it("stops observing on timeout and never starts another broadcast", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn(async () => {});
    const { connection, c } = fixture(Promise.resolve(unsubscribe), never());
    const result = send(connection, binding, "0x00", undefined, 50);
    const rejected = expect(result).rejects.toThrow(
      "Reconcile the saved transaction",
    );
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(c.api.sendTx).toHaveBeenCalledOnce();
    expect(c.receiptAt).not.toHaveBeenCalled();
  });
  it("checks the canonical receipt and releases the subscription after finality", async () => {
    const unsubscribe = vi.fn(async () => {});
    const { connection, c, receipt } = fixture(
      Promise.resolve(unsubscribe),
      Promise.resolve({
        status: { type: "Finalized", value: { blockHash: "0x11" } },
        txHash: "0x22",
      }),
    );
    await expect(send(connection, binding, "0x00")).resolves.toBe(receipt);
    expect(c.receiptAt).toHaveBeenCalledExactlyOnceWith("0x11", "0x22");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("cleans up a late subscription after finality has already rejected", async () => {
    let open!: (stop: () => Promise<void>) => void;
    const subscription = new Promise<() => Promise<void>>((resolve) => {
      open = resolve;
    });
    const unsubscribe = vi.fn(async () => {});
    const { connection, c } = fixture(
      subscription,
      Promise.reject(new Error("Observation disconnected")),
    );
    await expect(send(connection, binding, "0x00")).rejects.toThrow(
      "Observation disconnected",
    );
    open(unsubscribe);
    await subscription;
    await Promise.resolve();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(c.api.sendTx).toHaveBeenCalledOnce();
  });
});
