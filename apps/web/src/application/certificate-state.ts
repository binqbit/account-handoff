import { canonicalJson, verifyRecordDigest } from "@account-handoff/contracts";
import type { AccountingLedger } from "@account-handoff/contracts";
import {
  NativeConnection,
  hex,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import {
  readGrant,
  scanGrantHistory,
  type GrantHistory,
} from "@account-handoff/grant-adapter";
import { type Journal } from "@account-handoff/local-store";
import type { ChainView, WorkspaceRecord } from "./models";
import {
  assessCurrentContinuity,
  buildWorkspaceCertificate,
  certificateMatchesWorkspace,
  certificateReferencesPresent,
} from "./continuity";

export async function updateWorkspaceCertificate({
  workspace: w,
  chain: c,
  connection,
  journal,
  grantHistory,
  accounting: loadAccounting,
  saveWorkspace,
}: {
  workspace: WorkspaceRecord | null;
  chain: ChainView | null;
  connection: NativeConnection | null;
  journal: Journal | null;
  grantHistory: GrantHistory | null;
  accounting: (
    f: NativeFingerprint,
    accounts: ChainView["accounts"],
  ) => Promise<AccountingLedger | undefined>;
  saveWorkspace: () => Promise<void>;
}): Promise<void> {
  if (!w?.baseline || !w.pure || !c || !connection || !journal) return;
  const records = await journal.listRecords();
  let accounting: AccountingLedger | null = null;
  try {
    accounting = (await loadAccounting(c.fingerprint, c.accounts)) ?? null;
  } catch {
    /* The current assessment reports unavailable accounting. */
  }
  const trusted = w.continuityCertificate;
  const reusable =
    !!trusted &&
    certificateMatchesWorkspace(trusted, w, c.profile) &&
    certificateReferencesPresent(trusted, records) &&
    records.some(
      (record) =>
        record.kind === "ContinuityCertificate" &&
        record.recordId === trusted.recordId &&
        record.digest === trusted.digest,
    );
  if (!reusable) {
    // Restored workspace metadata is never trusted. Reconstruct a stored proof at its own
    // historical anchor, then assess today's state independently below.
    const historical = records
      .filter(
        (
          record,
        ): record is Extract<
          typeof record,
          { kind: "ContinuityCertificate" }
        > =>
          record.kind === "ContinuityCertificate" &&
          certificateMatchesWorkspace(record, w, c.profile) &&
          certificateReferencesPresent(record, records),
      )
      .sort((a, b) =>
        Number(BigInt(b.after.blockNumber) - BigInt(a.after.blockNumber)),
      )[0];
    let verified: Awaited<ReturnType<typeof buildWorkspaceCertificate>> = null;
    if (
      historical &&
      (await verifyRecordDigest(historical)) &&
      w.contract &&
      w.grantId !== null &&
      w.creationBlock !== undefined
    ) {
      const f = await connection.fingerprint(
        hex(historical.after.blockHash, 32),
      );
      const [pure, creator, grant, history] = await Promise.all([
        connection.readAccount(w.pure, f.anchor.hash),
        connection.readAccount(w.M0.account, f.anchor.hash),
        readGrant(
          connection,
          w.pure,
          w.contract,
          BigInt(w.grantId),
          f.anchor.hash,
        ),
        scanGrantHistory(connection, {
          contract: w.contract,
          grantId: w.grantId,
          fromBlock: w.creationBlock,
          toBlock: f.anchor.number,
        }),
      ]);
      const accounts = { [w.pure]: pure, [w.M0.account]: creator };
      const ledger = await loadAccounting(f, accounts);
      if (ledger)
        verified = await buildWorkspaceCertificate({
          connection: connection,
          workspace: w,
          profile: c.profile,
          beforeFingerprint: await connection.fingerprint(
            (w.handoffBaseline ?? w.baseline).blockHash,
          ),
          afterFingerprint: f,
          currentAccounts: accounts,
          currentGrant: grant,
          accounting: ledger,
          history,
          records,
        });
      if (verified) {
        const content = (certificate: typeof historical) =>
          canonicalJson({ ...certificate, recordId: "", digest: "" });
        if (content(verified.certificate) === content(historical)) {
          w.continuityCertificate = historical;
          verified = null;
        }
      }
    } else if (c.grant && accounting && grantHistory?.complete) {
      verified = await buildWorkspaceCertificate({
        connection: connection,
        workspace: w,
        profile: c.profile,
        beforeFingerprint: await connection.fingerprint(
          (w.handoffBaseline ?? w.baseline).blockHash,
        ),
        afterFingerprint: c.fingerprint,
        currentAccounts: c.accounts,
        currentGrant: c.grant,
        accounting,
        history: grantHistory,
        records,
      });
    }
    if (verified) {
      await journal.appendRecord(verified.beforeSnapshot);
      await journal.appendRecord(verified.afterSnapshot);
      await journal.appendRecord(verified.certificate);
      w.continuityCertificate = verified.certificate;
    }
    if (w.continuityCertificate) await saveWorkspace();
  }
  c.currentContinuity = assessCurrentContinuity({
    workspace: w,
    chain: c,
    accounting,
    history: grantHistory,
  });
}
