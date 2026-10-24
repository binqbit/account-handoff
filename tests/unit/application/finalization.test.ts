import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Postcondition } from "@account-handoff/contracts";
import {
  createLocalProgress,
  createSignedAttempt,
} from "@account-handoff/contracts";
import { openJournal, type Journal } from "@account-handoff/local-store";
import type {
  NativeConnection,
  NativeFingerprint,
  NativeReceipt,
} from "@account-handoff/native-adapter";
import { blake2AsHex } from "dedot/utils";
import { Application } from "../../../apps/web/src/application/application";
import type {
  ChainView,
  PendingOperation,
  WorkspaceRecord,
} from "../../../apps/web/src/application/models";
import {
  anchor,
  DIGEST,
  envelope,
  HASH,
  M0,
  M1,
  participants,
  profile,
  signingContext,
  snapshot,
} from "../../fixtures/core";

const journals: Journal[] = [];
afterEach(() => {
  journals.splice(0).forEach((journal) => journal.close());
});

describe("finalization after a workspace journal is reopened", () => {
  it.each([false, true])(
    "persists the receipt and history before certificate verification (interrupted: %s)",
    async (interruptCertificate) => {
      const app = await Application.create();
      interface Access {
        metadata: Journal;
        journal: Journal;
        chain: ChainView;
        connection: Pick<NativeConnection, "fingerprint">;
        workspaces: WorkspaceRecord[];
        currentId: string;
        pending: PendingOperation;
        recovery: unknown;
        refresh(): Promise<void>;
        postconditions(
          pending: PendingOperation,
          receipt: NativeReceipt,
        ): Promise<Postcondition[]>;
        render(): void;
        updateCertificate(): Promise<void>;
        finish(
          pending: PendingOperation,
          receipt: NativeReceipt,
        ): Promise<void>;
      }
      const access = app as unknown as Access;
      journals.push(access.metadata);
      const p = await profile(),
        s = await snapshot(p),
        e = await envelope(p, s),
        context = await signingContext(e);
      const bytes = "0x0400";
      const attempt = await createSignedAttempt({
        envelope: e,
        context,
        bytes,
        hash: blake2AsHex(bytes),
      });
      const namespace = `account-handoff:fixture:finalization-${crypto.randomUUID()}`;
      const oldJournal = await openJournal(namespace);
      journals.push(oldJournal);
      await oldJournal.appendRecord(p);
      await oldJournal.appendRecord(s);
      await oldJournal.sealEnvelope(e);
      const lease = await oldJournal.acquireLease(
        "operation:finalization",
        "test-tab",
        300_000,
      );
      if (!lease) throw new Error("Test lease was unavailable");
      await oldJournal.appendProgress(
        await createLocalProgress({
          envelope: e,
          context,
          atUnixSeconds: "100",
        }),
        lease,
      );
      await oldJournal.recordSignedAttempt(attempt, lease);
      const fingerprint: NativeFingerprint = {
        genesis: HASH as `0x${string}`,
        specName: "synthetic-finalization-test",
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
      const workspace: WorkspaceRecord = {
        id: "finalization",
        name: "Finalization test",
        createdAt: new Date().toISOString(),
        mode: "LOCAL",
        genesis: fingerprint.genesis,
        M0,
        M1,
        participants,
        pure: null,
        contract: null,
        grantId: null,
        creationEvidence: [],
        history: [],
        baseline: null,
      };
      const receipt: NativeReceipt = {
        txHash: blake2AsHex(bytes),
        blockHash: fingerprint.anchor.hash,
        blockNumber: 10,
        txIndex: 2,
        outerSuccess: true,
        nestedSuccess: true,
        businessExecuted: true,
        failure: null,
        events: [
          { pallet: "System", name: "ExtrinsicSuccess", data: {}, index: 3 },
        ],
      };
      const pending: PendingOperation = {
        id: "finalize-request",
        workspaceId: workspace.id,
        actionId: e.intent.operationId,
        fields: {},
        stage: "broadcast",
        title: "Fund M0",
        description: "Synthetic finalization fixture",
        action: { kind: "transfer", destination: M0.account, amount: 10n },
        innerAction: { kind: "transfer", destination: M0.account, amount: 10n },
        envelope: e,
        context,
        signedAttempt: attempt,
        signedBytes: bytes,
        receipt: null,
        lease,
        blockers: [],
        signer: participants.S,
        phase: "direct",
        route: [],
        resources: [],
        runScope: null,
        prepared: {
          payload: JSON.parse(context.originalSignPayloadJcsUtf8),
          rawPayload: "0x010000",
          callHex: "0x0100",
          callHash: HASH as `0x${string}`,
          signer: participants.S as `0x${string}`,
          extra: [],
          encodedExtra: "0x00",
          additionalSigned: "0x",
          fingerprint,
          createdAt: 100,
        },
      };
      access.journal = oldJournal;
      access.chain = {
        fingerprint,
        profile: p,
        accounts: {},
        grant: null,
        localDescriptor: null,
      };
      access.connection = {
        fingerprint: vi.fn().mockResolvedValue(fingerprint),
      };
      access.workspaces = [workspace];
      access.currentId = workspace.id;
      access.pending = pending;
      access.recovery = { stage: "broadcast" };
      access.render = vi.fn();
      access.postconditions = vi.fn().mockResolvedValue([
        {
          id: "funding-observed",
          result: "passed",
          anchor: anchor(),
          observations: [],
          explanation:
            "The test isolates journal replacement after an observed finalization.",
        },
      ]);
      access.refresh = vi.fn(async () => {
        oldJournal.close();
        access.journal = await openJournal(namespace);
        journals.push(access.journal);
      });
      if (interruptCertificate)
        access.updateCertificate = vi
          .fn()
          .mockRejectedValue(new Error("Certificate verification interrupted"));

      if (interruptCertificate)
        await expect(access.finish(pending, receipt)).rejects.toThrow(
          "Certificate verification interrupted",
        );
      else await access.finish(pending, receipt);

      expect(access.refresh).toHaveBeenCalledOnce();
      expect(access.journal).not.toBe(oldJournal);
      await expect(oldJournal.listRecords()).rejects.toThrow();
      const receipts = await access.journal.listRecords("ReceiptBundle");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        signedAttemptId: attempt.recordId,
        extrinsicHash: receipt.txHash,
        status: "finalized_success",
        businessEffect: "historically_verified",
      });
      expect(pending.stage).toBe("finalized");
      expect(access.render).toHaveBeenCalled();
      expect(workspace.history).toHaveLength(1);
      const storedWorkspaces =
        await access.metadata.getPreference<WorkspaceRecord[]>("workspaces");
      expect(storedWorkspaces?.[0]?.history).toHaveLength(1);
      expect(storedWorkspaces?.[0]?.history[0]?.attemptId).toBe(
        attempt.recordId,
      );
      expect(access.recovery).toBeNull();
      expect(await access.journal.getPreference("recovery")).toBeNull();
      const reopened = await openJournal(namespace);
      journals.push(reopened);
      expect(await reopened.listRecords("ReceiptBundle")).toEqual(receipts);
    },
  );
});
