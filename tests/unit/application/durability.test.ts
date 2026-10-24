import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../../../apps/web/src/application/application.js";
import type { PendingOperation } from "../../../apps/web/src/application/models.js";
import type { AppSnapshot } from "../../../apps/web/src/ui-contract.js";
import { requestSignature } from "@account-handoff/wallet-adapter";
import type { Journal } from "@account-handoff/local-store";
import type { SignerPayloadJSON } from "dedot/types";
import {
  DIGEST,
  HASH,
  envelope,
  profile,
  signedAttempt,
  signingContext,
  snapshot,
  participants,
} from "../../fixtures/core.js";

vi.mock("@account-handoff/wallet-adapter", async (original) => ({
  ...(await original<typeof import("@account-handoff/wallet-adapter")>()),
  requestSignature: vi.fn(),
}));

interface TestAccess {
  pending: PendingOperation;
  state: AppSnapshot;
  metadata: Journal;
  journal: Partial<Journal>;
  wallets: unknown[];
  connection: {
    send?: ReturnType<typeof vi.fn>;
    attachSignature?: ReturnType<typeof vi.fn>;
  };
  checkPending: ReturnType<typeof vi.fn>;
}
const opened: TestAccess[] = [];
beforeEach(() => {
  vi.mocked(requestSignature).mockReset();
});
afterEach(() => {
  for (const access of opened.splice(0)) access.metadata.close();
});

async function harness() {
  const app = await Application.create();
  const access = app as unknown as TestAccess;
  opened.push(access);
  const p = await profile(),
    e = await envelope(p, await snapshot(p)),
    context = await signingContext(e);
  const pending: PendingOperation = {
    id: "operation-test",
    workspaceId: "workspace-test",
    actionId: e.intent.operationId,
    fields: {},
    stage: "prepared",
    title: "Test funding",
    description: "Synthetic operation coordinator test",
    action: {
      kind: "transfer",
      destination: String(e.intent.parameters.recipient),
      amount: 10n,
    },
    innerAction: {
      kind: "transfer",
      destination: String(e.intent.parameters.recipient),
      amount: 10n,
    },
    envelope: e,
    context,
    signedAttempt: null,
    signedBytes: null,
    receipt: null,
    prepared: {
      payload: JSON.parse(
        context.originalSignPayloadJcsUtf8,
      ) as SignerPayloadJSON,
      rawPayload: "0x010000",
      callHex: "0x0100",
      callHash: HASH as `0x${string}`,
      signer: participants.S as `0x${string}`,
      extra: [],
      encodedExtra: "0x00",
      additionalSigned: "0x",
      createdAt: 100,
      fingerprint: {
        genesis: HASH as `0x${string}`,
        specName: "account-handoff-local",
        specVersion: 1,
        transactionVersion: 1,
        metadataVersion: 16,
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
      },
    },
    lease: {
      scope: "operation:workspace-test",
      owner: "tab-test",
      generation: 1,
      expiresAt: Date.now() + 10000,
    },
    blockers: [],
    signer: participants.S,
    phase: "direct",
    route: ["Native runtime"],
    resources: [],
    runScope: null,
  };
  access.pending = pending;
  access.checkPending = vi.fn().mockResolvedValue(pending); // Prior fresh-state checks are an explicit test boundary.
  access.state = {
    ...app.getSnapshot(),
    wallet: {
      connected: true,
      connecting: false,
      selectedAddress: participants.S,
      accounts: [{ address: participants.S, source: "test" }],
    },
  };
  access.wallets = [
    { source: "test", version: "test", accounts: access.state.wallet.accounts },
  ];
  access.connection = {};
  return { app, access, pending };
}

describe("actual coordinator durability boundaries", () => {
  it("does not invoke the wallet if the pre-wallet journal commit fails", async () => {
    const { app, access, pending } = await harness();
    const appendProgress = vi
      .fn()
      .mockRejectedValue(new Error("QuotaExceeded before wallet"));
    access.journal = { appendProgress, setPreference: vi.fn() };
    await expect(
      app.dispatch({ type: "sign-operation", id: pending.id }),
    ).rejects.toThrow("QuotaExceeded before wallet");
    expect(requestSignature).not.toHaveBeenCalled();
    expect(pending.stage).toBe("prepared");
  });
  it("retains an unknown send outcome and refuses an automatic replacement send", async () => {
    const { app, access, pending } = await harness();
    pending.stage = "signed";
    pending.signedBytes = "0x0400";
    pending.signedAttempt = await signedAttempt(pending.envelope);
    const send = vi
      .fn()
      .mockRejectedValue(new Error("provider lost after send"));
    const setPreference = vi.fn().mockResolvedValue(undefined);
    access.connection = { send };
    access.journal = { setPreference };
    await expect(
      app.dispatch({ type: "send-operation", id: pending.id }),
    ).rejects.toThrow("provider lost after send");
    expect(pending.stage).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
    expect(setPreference.mock.calls.at(-1)?.[1]).toMatchObject({
      stage: "unknown",
      attemptId: pending.signedAttempt.recordId,
    });
    await expect(
      app.dispatch({ type: "send-operation", id: pending.id }),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not broadcast when retaining returned signed bytes fails", async () => {
    const { app, access, pending } = await harness();
    vi.mocked(requestSignature).mockResolvedValue("0x00");
    const send = vi.fn();
    access.connection = {
      attachSignature: vi.fn().mockReturnValue("0x0400"),
      send,
    };
    access.journal = {
      appendProgress: vi.fn().mockResolvedValue(undefined),
      recordSignedAttempt: vi
        .fn()
        .mockRejectedValue(new Error("QuotaExceeded after signature")),
      setPreference: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      app.dispatch({ type: "sign-operation", id: pending.id }),
    ).rejects.toThrow("QuotaExceeded after signature");
    expect(requestSignature).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(pending.stage).toBe("unknown");
    expect(pending.signedAttempt).toBeNull();
  });
});
