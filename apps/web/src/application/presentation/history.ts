import type { HistoryEntryView } from "../../ui-contract";
import type { WorkspaceHistory } from "../models";

export function historyEntry(row: WorkspaceHistory): HistoryEntryView {
  const receipt = row.receipt;
  const success = receipt.outerSuccess && receipt.nestedSuccess;
  return {
    id: row.id,
    title: row.title,
    timestamp: row.at,
    block: String(receipt.blockNumber),
    txHash: receipt.txHash,
    state: !success
      ? "Execution failed"
      : receipt.businessExecuted
        ? "Executed"
        : "Approval recorded",
    tone: !success
      ? "negative"
      : receipt.businessExecuted
        ? "positive"
        : "neutral",
    detail:
      receipt.failure ??
      (receipt.businessExecuted
        ? "The business action executed in a finalized block. Its separate postconditions are available in the evidence."
        : "The outer transaction finalized. The business action has not executed yet."),
    layers: [
      {
        label: "Outer transaction",
        value: receipt.outerSuccess ? "Successful" : "Failed",
        tone: receipt.outerSuccess ? "positive" : "negative",
      },
      {
        label: "Nested execution",
        value: receipt.nestedSuccess ? "Successful" : "Failed",
        tone: receipt.nestedSuccess ? "positive" : "negative",
      },
      {
        label: "Business action",
        value: receipt.businessExecuted ? "Executed" : "Not executed",
        tone: receipt.businessExecuted ? "positive" : "neutral",
      },
    ],
    evidence: {
      operationId: row.operationId,
      signer: row.signer,
      grantId: row.grantId,
      envelopeDigest: row.envelopeDigest,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.txIndex,
      events: receipt.events,
    },
    operationId: row.attemptId,
    unresolved: false,
  };
}
