import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Application } from "../../../apps/web/src/application/application";
import type { Journal } from "@account-handoff/local-store";
import type { PendingOperation } from "../../../apps/web/src/application/models";
import type { OperationView } from "../../../apps/web/src/ui-contract";
import {
  canonicalJson,
  createFrozenEnvelope,
  createSignedAttempt,
  sealRecord,
  sha256,
} from "@account-handoff/contracts";
import { blake2AsHex } from "dedot/utils";
import {
  envelope,
  profile,
  signedAttempt,
  snapshot,
  M0,
  participants,
  DIGEST,
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
    fingerprint: {
      genesis: a.reviewedSigningContext.genesis,
      anchor: { hash: a.reviewedSigningContext.mortalityBlockHash, number: 10 },
      specName: "synthetic-test",
    },
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
    listProgress: vi.fn().mockResolvedValue([
      {
        phase: "SignedAttemptRecorded",
        envelopeDigest: e.digest,
        reviewedSigningContext: a.reviewedSigningContext,
        acceptedSignedAttemptId: a.recordId,
      },
    ]),
    acquireLease: vi.fn().mockResolvedValue({
      scope: "operation:workspace",
      owner: "tab",
      generation: 1,
      expiresAt: Date.now() + 10000,
    }),
  };
  return { access, p, e, a };
}

describe("recovery from durable canonical progress", () => {
  it("restores a known signed-before-send packet for explicit send without new signing or automatic broadcast", async () => {
    const { access, e, a } = await harness();
    const context = {
      ...a.reviewedSigningContext,
      outerCallHash: blake2AsHex(
        a.reviewedSigningContext.outerCallBytes as `0x${string}`,
      ),
    };
    const retained = await sealRecord({
      ...a,
      reviewedSigningContext: context,
      signingContextSha256: await sha256(canonicalJson(context)),
      signedExtrinsicHash: blake2AsHex(a.signedExtrinsicBytes as `0x${string}`),
    });
    const resumed = access as unknown as typeof access & {
      connection: {
        transaction: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        prepareSigning: ReturnType<typeof vi.fn>;
      };
      checkPending: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
      operationView(): OperationView;
      send(id: string): Promise<void>;
    };
    access.recovery = {
      id: "request",
      workspaceId: "workspace",
      actionId: e.intent.operationId,
      title: "Recovery",
      stage: "signed",
      envelopeId: e.recordId,
      context,
      attemptId: retained.recordId,
      signer: retained.signer,
    };
    access.journal.getRecord = vi.fn(async (id) =>
      id === e.recordId ? e : id === retained.recordId ? retained : undefined,
    );
    access.journal.setPreference = vi.fn().mockResolvedValue(undefined);
    resumed.connection.transaction = vi
      .fn()
      .mockReturnValue({ callHex: context.outerCallBytes });
    resumed.connection.send = vi
      .fn()
      .mockResolvedValue({ blockHash: "explicit-send-receipt" });
    resumed.connection.prepareSigning = vi.fn();
    resumed.checkPending = vi.fn(async () => access.pending);
    resumed.render = vi.fn();
    await access.reconcile("request");
    expect(resumed.checkPending).toHaveBeenCalledWith("request");
    expect(access.pending).toMatchObject({
      stage: "signed",
      signedBytes: retained.signedExtrinsicBytes,
      context,
      envelope: e,
    });
    expect(resumed.operationView().canSend).toBe(true);
    expect(resumed.operationView().canSign).toBe(false);
    expect(resumed.connection.send).not.toHaveBeenCalled();
    expect(resumed.connection.prepareSigning).not.toHaveBeenCalled();
    expect(access.connection.findReceipt).not.toHaveBeenCalled();
    await resumed.send("request");
    expect(resumed.connection.send).toHaveBeenCalledExactlyOnceWith(
      retained.signedExtrinsicBytes,
    );
    expect(resumed.connection.prepareSigning).not.toHaveBeenCalled();
  });
  it("does not offer Send if current guards reject restored signed bytes", async () => {
    const { access, e, a } = await harness();
    const context = {
      ...a.reviewedSigningContext,
      outerCallHash: blake2AsHex(
        a.reviewedSigningContext.outerCallBytes as `0x${string}`,
      ),
    };
    const retained = await sealRecord({
      ...a,
      reviewedSigningContext: context,
      signingContextSha256: await sha256(canonicalJson(context)),
      signedExtrinsicHash: blake2AsHex(a.signedExtrinsicBytes as `0x${string}`),
    });
    access.recovery = {
      id: "request",
      workspaceId: "workspace",
      actionId: e.intent.operationId,
      title: "Recovery",
      stage: "signed",
      envelopeId: e.recordId,
      context,
      attemptId: retained.recordId,
      signer: retained.signer,
    };
    access.journal.getRecord = vi.fn(async (id) =>
      id === e.recordId ? e : id === retained.recordId ? retained : undefined,
    );
    access.journal.releaseLease = vi.fn().mockResolvedValue(undefined);
    const current = access as unknown as typeof access & {
      connection: { transaction: ReturnType<typeof vi.fn> };
      checkPending: ReturnType<typeof vi.fn>;
    };
    current.connection.transaction = vi
      .fn()
      .mockReturnValue({ callHex: context.outerCallBytes });
    current.checkPending = vi
      .fn()
      .mockRejectedValue(new Error("Nonce changed"));
    await expect(access.reconcile("request")).rejects.toThrow("Nonce changed");
    expect(access.pending).toBeNull();
    expect(access.journal.releaseLease).toHaveBeenCalledOnce();
  });
  it("reconstructs the stored final multisig wrapper and exact timepoint before enabling Send", async () => {
    const { access, p, e: base, a: baseAttempt } = await harness();
    const innerBytes = "0x0100",
      outerBytes = "0x0200";
    const e = await createFrozenEnvelope({
      intent: {
        ...base.intent,
        operationId: "GRC-SETUP-CREATE-PURE",
        authorActor: participants.A,
        parameters: { pureIndex: "0", proxyType: "Any", delay: "0" },
        expectedState: {
          ...base.intent.expectedState,
          authority: "NotCreated",
        },
      },
      anchor: base.anchor,
      plan: {
        controller: M0,
        requiredSigners: [participants.A, participants.B],
        signingPath: "multisig_direct",
        callTree: {
          kind: "native_call",
          palletOrContract: "Proxy",
          method: "create_pure",
          parameters: { proxyType: "Any", delay: "0", index: "0" },
          children: [],
          sourceEvidence: base.evidence,
        },
      },
      innerRuntimeCallBytes: innerBytes,
      innerRuntimeCallHash: blake2AsHex(innerBytes),
      resources: {
        ...base.resources,
        valueNative: "0",
        multisigInnerMaxWeight: { refTime: "10", proofSize: "0" },
      },
      summaryText: "Synthetic final creation",
      requiredGateIds: base.requiredGateIds,
      participants,
      evidence: base.evidence,
    });
    const originalPayload = JSON.parse(
      baseAttempt.reviewedSigningContext.originalSignPayloadJcsUtf8,
    );
    originalPayload.address = participants.B;
    originalPayload.method = outerBytes;
    const originalSignPayloadJcsUtf8 = canonicalJson(originalPayload);
    const context = {
      ...baseAttempt.reviewedSigningContext,
      signer: participants.B,
      outerCallBytes: outerBytes,
      outerCallHash: blake2AsHex(outerBytes),
      operationPhase: "multisig_final" as const,
      nativeProposalDigest: DIGEST,
      originalSignPayloadJcsUtf8,
      signPayloadSha256: await sha256(originalSignPayloadJcsUtf8),
    };
    const retained = await createSignedAttempt({
      envelope: e,
      context,
      bytes: "0x0400",
      hash: blake2AsHex("0x0400"),
    });
    access.recovery = {
      id: "request",
      workspaceId: "workspace",
      actionId: e.intent.operationId,
      title: "Recovery",
      stage: "signed",
      envelopeId: e.recordId,
      context,
      attemptId: retained.recordId,
      signer: retained.signer,
    };
    access.journal.getRecord = vi.fn(async (id) =>
      id === e.recordId ? e : id === retained.recordId ? retained : undefined,
    );
    access.journal.getRecordByDigest = vi
      .fn()
      .mockResolvedValue({
        kind: "NativeProposal",
        digest: DIGEST,
        profileDigest: p.digest,
        multisig: M0.account,
        innerCallHash: e.innerRuntimeCallHash,
        timepoint: {
          height: "5",
          index: "3",
          clockDomain: "native-block-number",
        },
      });
    access.journal.setPreference = vi.fn().mockResolvedValue(undefined);
    const current = access as unknown as typeof access & {
      connection: { transaction: ReturnType<typeof vi.fn> };
      checkPending: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
    };
    current.connection.transaction = vi.fn((action) => ({
      callHex: action.kind === "multisig" ? outerBytes : innerBytes,
    }));
    current.checkPending = vi.fn(async () => access.pending);
    current.render = vi.fn();
    await access.reconcile("request");
    expect(access.pending?.action).toMatchObject({
      kind: "multisig",
      others: [participants.A, participants.C],
      timepoint: { height: 5, index: 3 },
      weight: { refTime: 10n, proofSize: 0n },
    });
    expect(access.pending?.signedBytes).toBe(retained.signedExtrinsicBytes);
    expect(access.connection.findReceipt).not.toHaveBeenCalled();
  });
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
  it("keeps unknown or broadcast outcomes reconcile-only even when their signed packet is retained", async () => {
    const { access } = await harness();
    access.connection.findReceipt.mockResolvedValue(null);
    await expect(access.reconcile("request")).rejects.toThrow(/не знайдено/);
    expect(access.pending).toBeNull();
    expect(access.journal.acquireLease).not.toHaveBeenCalled();
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
