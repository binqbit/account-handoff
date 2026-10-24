import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $Era } from "dedot/codecs";
import { u8aToHex } from "dedot/utils";
import type { SignerPayloadJSON } from "dedot/types";
import { canonicalJson, sha256 } from "@account-handoff/contracts";
import type { Journal } from "@account-handoff/local-store";
import { Application } from "../../../apps/web/src/application/application";
import type { PendingOperation } from "../../../apps/web/src/application/models";
import type { OperationView } from "../../../apps/web/src/ui-contract";
import {
  DIGEST,
  HASH,
  envelope,
  profile,
  signingContext,
  snapshot,
} from "../../fixtures/core";

const journals: Journal[] = [];
afterEach(() => journals.splice(0).forEach((journal) => journal.close()));

async function harness(height: number, stage: PendingOperation["stage"]) {
  const app = await Application.create();
  const p = await profile(),
    e = await envelope(p, await snapshot(p)),
    context = await signingContext(e);
  context.era = u8aToHex($Era.tryEncode({ period: 64n, current: 10n }));
  const payload = {
    ...JSON.parse(context.originalSignPayloadJcsUtf8),
    era: context.era,
    blockNumber: "0xa",
  };
  context.originalSignPayloadJcsUtf8 = canonicalJson(payload);
  context.signPayloadSha256 = await sha256(context.originalSignPayloadJcsUtf8);
  const fingerprint = {
    genesis: HASH as `0x${string}`,
    specName: "synthetic",
    specVersion: 1,
    transactionVersion: 1,
    metadataVersion: 16,
    metadataHash: HASH as `0x${string}`,
    metadataSha256: DIGEST,
    rawMetadata: "0x00" as const,
    runtimeCodeHash: HASH as `0x${string}`,
    signedExtensions: [],
    runtimeApis: {},
    anchor: { hash: HASH as `0x${string}`, number: height },
    tokenDecimals: 14,
    tokenSymbol: "UNIT",
    ss58Prefix: 42,
  };
  const pending: PendingOperation = {
    id: "mortality-test",
    workspaceId: "workspace",
    actionId: e.intent.operationId,
    fields: {},
    stage,
    title: "Synthetic mortality guard",
    description: "",
    action: { kind: "map-account" },
    innerAction: { kind: "map-account" },
    envelope: e,
    context,
    prepared: {
      payload: payload as SignerPayloadJSON,
      rawPayload: "0x00",
      callHex: "0x0100",
      callHash: HASH as `0x${string}`,
      signer: context.signer as `0x${string}`,
      extra: [],
      encodedExtra: "0x00",
      additionalSigned: "0x",
      fingerprint,
      createdAt: 0,
    },
    signedAttempt: null,
    signedBytes: null,
    receipt: null,
    lease: {
      scope: "operation:workspace",
      owner: "test",
      generation: 1,
      expiresAt: Date.now() + 10000,
    },
    blockers: [],
    signer: context.signer,
    phase: "direct",
    route: [],
    resources: [],
    runScope: null,
  };
  const access = app as unknown as {
    metadata: Journal;
    pending: PendingOperation;
    recovery: unknown;
    chain: object;
    connection: object;
    journal: Partial<Journal>;
    workspace: ReturnType<typeof vi.fn>;
    checkPending(id: string): Promise<PendingOperation>;
    operationView(): OperationView;
  };
  journals.push(access.metadata);
  access.pending = pending;
  access.recovery = { stage };
  access.chain = { profile: p };
  access.connection = { fingerprint: vi.fn().mockResolvedValue(fingerprint) };
  access.workspace = vi.fn().mockReturnValue({ id: "workspace" });
  access.journal = {
    assertLease: vi.fn().mockResolvedValue(undefined),
    releaseLease: vi.fn().mockResolvedValue(undefined),
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
  return { pending, access };
}

describe("coordinator native mortality guard", () => {
  it.each(["prepared", "signed"] as const)(
    "marks %s stale exactly at its finalized native death",
    async (stage) => {
      const { pending, access } = await harness(74, stage);
      await expect(access.checkPending(pending.id)).rejects.toThrow(
        /expired at block 74/,
      );
      expect(pending.stage).toBe("stale");
      expect(access.recovery).toBeNull();
      expect(access.journal.setPreference).toHaveBeenCalledWith(
        "recovery",
        null,
      );
      expect(access.journal.releaseLease).toHaveBeenCalledWith(pending.lease);
      expect(access.operationView().canDiscard).toBe(true);
    },
  );
  it("does not declare expiry one native block early", async () => {
    const { pending, access } = await harness(73, "signed");
    await expect(access.checkPending(pending.id)).rejects.toThrow(
      "Signer changed",
    );
    expect(pending.stage).toBe("signed");
    expect(access.journal.setPreference).not.toHaveBeenCalled();
  });
  it("preserves unknown execution outcomes after outer era expires", async () => {
    const { pending, access } = await harness(138, "unknown");
    await expect(access.checkPending(pending.id)).rejects.toThrow(/expired/);
    expect(pending.stage).toBe("unknown");
    expect(access.recovery).toEqual({ stage: "unknown" });
    expect(access.journal.setPreference).not.toHaveBeenCalled();
    expect(access.journal.releaseLease).not.toHaveBeenCalled();
    expect(access.operationView().canDiscard).toBe(false);
  });
});
