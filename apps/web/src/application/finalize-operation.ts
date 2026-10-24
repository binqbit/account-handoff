import { canonicalJson, sha256 } from "@account-handoff/contracts";
import type { EvidenceRef, Postcondition } from "@account-handoff/contracts";

import {
  NativeConnection,
  account,
  hex,
  type NativeReceipt,
} from "@account-handoff/native-adapter";

import {
  scanGrantHistory,
  type GrantHistory,
} from "@account-handoff/grant-adapter";
import { type Journal } from "@account-handoff/local-store";

import type { ChainView, WorkspaceRecord, PendingOperation } from "./models";

import { buildReadAnchor, buildReceipt } from "./record-builders";

import { id } from "./values";
import { findContractEvent } from "./contract-events";
export async function finalizeOperation(
  {
    workspace: w,
    connection,
    appendRecord,
    refresh,
    postconditions,
  }: {
    workspace: WorkspaceRecord;
    connection: NativeConnection;
    appendRecord: Journal["appendRecord"];
    refresh: () => Promise<ChainView>;
    postconditions: (
      p: PendingOperation,
      receipt: NativeReceipt,
    ) => Promise<Postcondition[]>;
  },
  p: PendingOperation,
  receipt: NativeReceipt,
): Promise<void> {
  if (!p.signedAttempt) throw new Error("Operation context was lost");
  p.receipt = receipt;
  const evidence: EvidenceRef = {
    kind: "native_chain",
    locator: `${receipt.blockHash}/${receipt.txIndex}`,
    sourceId: receipt.txHash,
    contentSha256: await sha256(canonicalJson(receipt)),
  };
  if (receipt.businessExecuted && p.actionId === "GRC-SETUP-CREATE-PURE") {
    const created = receipt.events.find(
      (e) => e.pallet === "Proxy" && e.name === "PureCreated",
    );
    if (!created) throw new Error("The Pure creation event is missing");
    w.pure = account(String(created.data["pure"]));
    w.creationEvidence = [evidence];
    w.creationBlock = receipt.blockNumber;
  }
  if (receipt.businessExecuted && p.actionId === "GRC-GRANT-CREATE") {
    w.contract = hex(String(p.envelope.intent.parameters["contract"]), 20);
    const log = findContractEvent(receipt, w.contract, "GrantCreated");
    w.grantId = String(log["grantId"]);
  }
  const chain = await refresh();
  const f = await connection.fingerprint(receipt.blockHash);
  const anchor = buildReadAnchor(chain.profile, f);
  const check = await postconditions(p, receipt);
  let history: GrantHistory | null = null;
  if (w.contract && w.grantId !== null && w.creationBlock !== undefined)
    history = await scanGrantHistory(connection, {
      contract: w.contract,
      grantId: w.grantId,
      fromBlock: w.creationBlock,
      toBlock: receipt.blockNumber,
    });
  const expectedName =
    p.actionId === "GRC-GRANT-CREATE"
      ? "GrantCreated"
      : p.actionId === "GRC-GRANT-APPROVE"
        ? "MilestoneApproved"
        : "MilestoneSubmitted";
  const intended = history?.entries.find(
    (e) =>
      e.blockHash === receipt.blockHash &&
      e.txIndex === receipt.txIndex &&
      e.eventName === expectedName,
  );
  const round =
    history?.complete && intended
      ? expectedName === "GrantCreated"
        ? 0
        : intended.roundBefore
      : null;
  const bundle = await buildReceipt(
    p.envelope,
    p.signedAttempt,
    receipt,
    anchor,
    p.phase,
    {
      postconditions: check,
      ...(p.phase === "cancel"
        ? {
            targetProposalAfter:
              check.find((item) => item.id === "cancel-target")?.result ===
              "passed"
                ? ("cancelled" as const)
                : ("unknown" as const),
          }
        : {}),
      ...(round !== null ? { roundAtIntendedEvent: String(round) } : {}),
      orderedHistoryComplete: history?.complete ?? false,
    },
  );
  await appendRecord(bundle);
  const verified =
    receipt.nestedSuccess &&
    check.every((c) => c.result === "passed") &&
    bundle.businessEffect === "historically_verified";
  receipt.businessExecuted = verified && receipt.businessExecuted;
  const historyRow = {
    id: id(),
    operationId: p.actionId,
    title: p.title,
    at: new Date().toISOString(),
    signer: p.signer,
    receipt,
    envelopeDigest: p.envelope.digest,
    attemptId: p.signedAttempt.recordId,
    grantId: w.grantId,
    handoffId: w.handoffId ?? "initial",
  };
  const previous = w.history.findIndex(
    (row) => row.attemptId === p.signedAttempt!.recordId,
  );
  if (previous < 0) w.history.push(historyRow);
  else w.history[previous] = { ...historyRow, id: w.history[previous]!.id };
  p.stage =
    bundle.status === "unresolved"
      ? "unknown"
      : bundle.status === "finalized_failure"
        ? "failed"
        : "finalized";
  p.blockers = check
    .filter((c) => c.result !== "passed")
    .map((c) => c.explanation);
}
