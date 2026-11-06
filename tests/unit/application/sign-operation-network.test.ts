import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignature } from "@account-handoff/wallet-adapter";
import type { WalletSession } from "@account-handoff/wallet-adapter";
import type { Journal } from "@account-handoff/local-store";
import type { NativeConnection } from "@account-handoff/native-adapter";
import { signOperation } from "../../../apps/web/src/application/sign-operation";
import type { PendingOperation } from "../../../apps/web/src/application/models";
import {
  envelope,
  profile,
  signingContext,
  snapshot,
  participants,
} from "../../fixtures/core";

vi.mock("@account-handoff/wallet-adapter", async (original) => ({
  ...(await original<typeof import("@account-handoff/wallet-adapter")>()),
  requestSignature: vi.fn(),
}));
afterEach(() => vi.mocked(requestSignature).mockReset());
async function harness() {
  const p = await profile();
  const e = await envelope(p, await snapshot(p));
  const context = await signingContext(e);
  const pending = {
    id: "operation",
    stage: "prepared",
    context,
    envelope: e,
    blockers: [],
    prepared: {
      payload: JSON.parse(context.originalSignPayloadJcsUtf8),
      rawPayload: "0x00",
    },
    signedBytes: null,
    signedAttempt: null,
    lease: {
      scope: "operation:test",
      owner: "test",
      generation: 1,
      expiresAt: Date.now() + 10000,
    },
  } as unknown as PendingOperation;
  let current = true;
  const journal = {
    appendProgress: vi.fn().mockResolvedValue(undefined),
    setPreference: vi.fn().mockResolvedValue(undefined),
    recordSignedAttempt: vi.fn().mockResolvedValue(undefined),
  };
  const connection = { attachSignature: vi.fn().mockReturnValue("0x0400") };
  const input = {
    checkPending: vi.fn().mockResolvedValue(pending),
    assertNetworkUnchanged: () => {
      if (!current) throw new Error("Network changed before signing");
    },
    getSelected: () => ({ source: "test", address: participants.S }),
    wallets: [{ source: "test" } as WalletSession],
    journal: journal as unknown as Journal,
    connection: connection as unknown as NativeConnection,
    saveRecovery: vi.fn().mockResolvedValue(undefined),
    clearRecovery: vi.fn(),
    render: vi.fn(),
  };
  vi.mocked(requestSignature).mockResolvedValue("0x00");
  return {
    pending,
    input,
    journal,
    connection,
    lose: () => {
      current = false;
    },
  };
}

describe("network loss before an explicit wallet request", () => {
  it("does not overwrite a stale review or open a wallet after the progress write", async () => {
    const h = await harness();
    h.journal.appendProgress.mockImplementationOnce(async () => {
      h.lose();
      h.pending.stage = "stale";
    });
    await expect(signOperation(h.input, h.pending.id)).rejects.toThrow();
    expect(requestSignature).not.toHaveBeenCalled();
    expect(h.pending.stage).toBe("stale");
  });
  it("does not open the wallet if the connection changes while its recovery checkpoint is saved", async () => {
    const h = await harness();
    h.input.saveRecovery.mockImplementationOnce(async () => h.lose());
    await expect(signOperation(h.input, h.pending.id)).rejects.toThrow(
      "Network changed",
    );
    expect(requestSignature).not.toHaveBeenCalled();
    expect(h.pending.stage).toBe("stale");
    expect(h.journal.setPreference).toHaveBeenCalledWith("recovery", null);
  });
  it("retains an uncertain signed response for reconciliation without attaching or broadcasting bytes", async () => {
    const h = await harness();
    vi.mocked(requestSignature).mockImplementationOnce(async () => {
      h.lose();
      return "0x00";
    });
    await expect(signOperation(h.input, h.pending.id)).rejects.toThrow(
      "Network changed",
    );
    expect(requestSignature).toHaveBeenCalledOnce();
    expect(h.pending.stage).toBe("unknown");
    expect(h.pending.signedBytes).toBeNull();
    expect(h.connection.attachSignature).not.toHaveBeenCalled();
    expect(h.journal.recordSignedAttempt).not.toHaveBeenCalled();
    expect(h.input.saveRecovery).toHaveBeenLastCalledWith(h.pending);
  });
  it("retains the explicit signature normally when the reviewed connection stays current", async () => {
    const h = await harness();
    await signOperation(h.input, h.pending.id);
    expect(requestSignature).toHaveBeenCalledOnce();
    expect(h.pending.stage).toBe("signed");
    expect(h.pending.signedBytes).toBe("0x0400");
    expect(h.journal.recordSignedAttempt).toHaveBeenCalledOnce();
  });
});
