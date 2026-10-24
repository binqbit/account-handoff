import { verifyRecordDigest } from "@account-handoff/contracts";
import type { AccountingLedger } from "@account-handoff/contracts";
import type { GrantHistory } from "@account-handoff/grant-adapter";
import type { Journal } from "@account-handoff/local-store";
import {
  contractAddress,
  hex,
  type NativeConnection,
} from "@account-handoff/native-adapter";
import { assessBacking } from "@account-handoff/domain";
import {
  currentHandoffHistory,
  hasHandoff,
  type ChainView,
  type WorkspaceRecord,
} from "./models";
import { proveReceipt } from "./continuity/receipt-proof";
import { advanceHandoff } from "./workspace-state";
import { authority } from "./presentation/shared";

/** Re-read signed native evidence before promoting the replacement to current controller. */
export async function verifyAndAdvanceHandoff({
  workspace: w,
  chain,
  connection,
  journal,
  history,
  accounting,
}: {
  workspace: WorkspaceRecord;
  chain: ChainView;
  connection: NativeConnection;
  journal: Journal;
  history: GrantHistory;
  accounting: AccountingLedger | undefined;
}): Promise<WorkspaceRecord> {
  const baseline = w.handoffBaseline ?? w.baseline;
  const pure = w.pure ? chain.accounts[w.pure] : null;
  if (
    !hasHandoff(w) ||
    !w.pure ||
    !baseline ||
    !chain.grant ||
    !accounting ||
    !assessBacking(accounting).backed ||
    !history.complete ||
    chain.profile.status !== "accepted" ||
    chain.fingerprint.genesis !== w.genesis ||
    chain.fingerprint.runtimeCodeHash !== chain.profile.runtimeCodeHash ||
    chain.fingerprint.metadataSha256 !== chain.profile.metadataSha256 ||
    !pure ||
    pure.mappedTo !== w.pure ||
    pure.mappedAddress !== contractAddress(w.pure) ||
    authority(w, chain) !== "M1"
  )
    throw new Error(
      "Verify the completed handoff, grant identity and reserve backing before starting another.",
    );
  if (
    chain.grant.grantee !== baseline.grant.grantee ||
    chain.grant.funder !== baseline.grant.funder
  )
    throw new Error(
      "The current grant identity differs from the saved handoff checkpoint.",
    );
  const records = await journal.listRecords();
  const rows = currentHandoffHistory(w);
  const candidates = records.filter(
    (record) =>
      record.kind === "ReceiptBundle" &&
      record.operationId === "GRC-ROTATION-REMOVE-M0" &&
      rows.some(
        (row) =>
          row.grantId === w.grantId &&
          row.operationId === record.operationId &&
          row.attemptId === record.signedAttemptId &&
          row.receipt.txHash === record.extrinsicHash,
      ),
  );
  for (const candidate of candidates) {
    if (candidate.kind !== "ReceiptBundle") continue;
    const checkpoint = await connection.fingerprint(
      hex(candidate.blockHash, 32),
    );
    if (
      checkpoint.genesis !== w.genesis ||
      checkpoint.runtimeCodeHash !== chain.profile.runtimeCodeHash ||
      checkpoint.metadataSha256 !== chain.profile.metadataSha256
    )
      continue;
    const proof = await proveReceipt(
      {
        workspace: w,
        connection,
        profile: chain.profile,
        beforeFingerprint: await connection.fingerprint(baseline.blockHash),
        afterFingerprint: chain.fingerprint,
        currentAccounts: chain.accounts,
        currentGrant: chain.grant,
        accounting,
        history,
        records,
      },
      candidate,
      baseline.account,
    );
    if (
      !proof ||
      !(
        await Promise.all(
          [proof.receipt, proof.attempt, proof.envelope, proof.proposal].map(
            verifyRecordDigest,
          ),
        )
      ).every(Boolean)
    )
      continue;
    return advanceHandoff(w, proof.receipt.recordId);
  }
  throw new Error(
    "The completed handoff's native approval and removal receipts could not be verified.",
  );
}
