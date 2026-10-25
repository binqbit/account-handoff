import { expect, type Page, type TestInfo } from "@playwright/test";
import type { ReceiptBundle } from "@account-handoff/contracts";
import { hex, type NativeConnection } from "@account-handoff/native-adapter";

/** Reconcile every browser-persisted receipt against canonical native finality. */
export async function captureJournalEvidence(
  page: Page,
  testInfo: TestInfo,
  connection: NativeConnection,
  expectedReceipts: number,
): Promise<void> {
  const receipts = await page.evaluate(async () => {
    const result: unknown[] = [];
    for (const entry of await indexedDB.databases()) {
      if (!entry.name?.startsWith("account-handoff:local:")) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(entry.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains("records")) continue;
        const records = await new Promise<{ kind: string }[]>(
          (resolve, reject) => {
            const request = database
              .transaction("records", "readonly")
              .objectStore("records")
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        result.push(
          ...records.filter((record) => record.kind === "ReceiptBundle"),
        );
      } finally {
        database.close();
      }
    }
    return result;
  });
  const unique = [
    ...new Map(
      (receipts as ReceiptBundle[]).map((record) => [
        record.extrinsicHash,
        record,
      ]),
    ).values(),
  ];
  expect(unique).toHaveLength(expectedReceipts);
  const reconciled = [];
  for (const record of unique) {
    expect(record.status).toBe("finalized_success");
    const native = await connection.receiptAt(
      hex(record.blockHash, 32),
      hex(record.extrinsicHash, 32),
    );
    expect(native.outerSuccess).toBe(true);
    expect(String(native.txIndex)).toBe(record.extrinsicIndex);
    expect(native.txHash).toBe(record.extrinsicHash);
    reconciled.push({ record, native });
  }
  await testInfo.attach("canonical-native-receipts-and-browser-journal", {
    body: JSON.stringify(reconciled, null, 2),
    contentType: "application/json",
  });
}
