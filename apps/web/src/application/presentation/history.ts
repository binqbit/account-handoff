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
      ? "Помилка виконання"
      : receipt.businessExecuted
        ? "Виконано"
        : "Схвалення зафіксовано",
    tone: !success
      ? "negative"
      : receipt.businessExecuted
        ? "positive"
        : "neutral",
    detail:
      receipt.failure ??
      (receipt.businessExecuted
        ? "Бізнес-дію виконано у фіналізованому блоці. Її окремі післяумови доступні в доказах."
        : "Зовнішню транзакцію фіналізовано. Це ще не виконання бізнес-дії."),
    layers: [
      {
        label: "Зовнішня транзакція",
        value: receipt.outerSuccess ? "Успішна" : "Помилка",
        tone: receipt.outerSuccess ? "positive" : "negative",
      },
      {
        label: "Вкладене виконання",
        value: receipt.nestedSuccess ? "Успішне" : "Помилка",
        tone: receipt.nestedSuccess ? "positive" : "negative",
      },
      {
        label: "Бізнес-дія",
        value: receipt.businessExecuted ? "Виконана" : "Не виконана",
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
