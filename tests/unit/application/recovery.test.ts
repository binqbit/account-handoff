import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Application } from "../../../apps/web/src/application/application";
import type { Journal } from "@account-handoff/local-store";
import type { PendingOperation } from "../../../apps/web/src/application/models";
import {
  envelope,
  profile,
  signedAttempt,
  snapshot,
} from "../../fixtures/core";

const journals: Journal[] = [];
afterEach(() => {
  journals.splice(0).forEach((journal) => journal.close());
});

async function harness() {
  const app = await Application.create();
  const p = await profile(),
    e = await envelope(p, await snapshot(p)),
    a = await signedAttempt(e);
  interface Access {
    metadata: Journal;
    pending: Partial<PendingOperation> | null;
    recovery: unknown;
    chain: unknown;
    connection: { findReceipt: ReturnType<typeof vi.fn> };
    journal: Partial<Journal>;
    workspace: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    reconcile(id: string): Promise<void>;
  }
  const access = app as unknown as Access;
  journals.push(access.metadata);
  access.pending = null;
  access.chain = {
    profile: p,
    fingerprint: { genesis: a.reviewedSigningContext.genesis },
    localDescriptor: null,
  };
  access.workspace = vi.fn().mockReturnValue({ id: "workspace" });
  access.connection = {
    findReceipt: vi.fn().mockResolvedValue({ blockHash: "receipt" }),
  };
  access.finish = vi.fn().mockResolvedValue(undefined);
  access.recovery = {
    id: "request",
    workspaceId: "workspace",
    actionId: e.intent.operationId,
    title: "Recovery",
    stage: "wallet-requested",
    envelopeId: e.recordId,
    context: a.reviewedSigningContext,
    attemptId: null,
    signer: a.signer,
  };
  access.journal = {
    getRecord: vi.fn(async (id) =>
      id === e.recordId ? e : id === a.recordId ? a : undefined,
    ),
    listProgress: vi
      .fn()
      .mockResolvedValue([
        {
          phase: "SignedAttemptRecorded",
          envelopeDigest: e.digest,
          reviewedSigningContext: a.reviewedSigningContext,
          acceptedSignedAttemptId: a.recordId,
        },
      ]),
    acquireLease: vi
      .fn()
      .mockResolvedValue({
        scope: "operation:workspace",
        owner: "tab",
        generation: 1,
        expiresAt: Date.now() + 10000,
      }),
  };
  return { access, p, e, a };
}

describe("recovery from durable canonical progress", () => {
  it("finds recorded signed bytes when a crash preceded the recovery-preference update", async () => {
    const { access, a } = await harness();
    await access.reconcile("request");
    expect(access.connection.findReceipt).toHaveBeenCalledWith(
      a.signedExtrinsicHash,
    );
    expect(access.finish).toHaveBeenCalledWith(
      expect.objectContaining({ signedAttempt: a }),
      { blockHash: "receipt" },
    );
  });
  it("does not infer a signed attempt from a wallet-requested record alone", async () => {
    const { access } = await harness();
    vi.mocked(access.journal.listProgress!).mockResolvedValue([]);
    await expect(access.reconcile("request")).rejects.toThrow(
      /підписані байти/,
    );
    expect(access.connection.findReceipt).not.toHaveBeenCalled();
  });
  it("refuses in-memory reconciliation after the active profile changed", async () => {
    const { access, e, a } = await harness();
    access.pending = {
      id: "request",
      workspaceId: "workspace",
      envelope: e,
      signedAttempt: a,
    };
    access.chain = { profile: { digest: "other-profile" } };
    await expect(access.reconcile("request")).rejects.toThrow(/профіль/);
    expect(access.connection.findReceipt).not.toHaveBeenCalled();
  });
});
