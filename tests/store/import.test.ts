import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDB, openDB } from "idb";
import { openJournal, type Journal } from "@account-handoff/local-store";
import {
  exportPortable,
  sealRecord,
  semanticIntentDigest,
  type CanonicalRecord,
} from "@account-handoff/contracts";
import {
  envelope,
  profile,
  progress,
  signedAttempt,
  snapshot,
} from "../fixtures/core";

const opened: Journal[] = [];
async function journal(): Promise<Journal> {
  const value = await openJournal(
    `account-handoff:fixture:atomic-import-${crypto.randomUUID()}`,
  );
  opened.push(value);
  return value;
}
async function records(prefix: string, intentId = "shared-intent") {
  const p = await sealRecord({
    ...(await profile()),
    recordId: `${prefix}:profile`,
  });
  const s = await sealRecord({
    ...(await snapshot(p)),
    recordId: `${prefix}:snapshot`,
  });
  const proposed = {
    ...(await envelope(p, s)),
    recordId: `${prefix}:envelope`,
  };
  proposed.intent.intentId = intentId;
  proposed.semanticIntentDigest = await semanticIntentDigest(proposed);
  const e = await sealRecord(proposed);
  return { p, s, e, all: [p, s, e] };
}
async function seals(namespace: string) {
  const db = await openDB(namespace);
  try {
    return await db.getAll("semanticSeals");
  } finally {
    db.close();
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of opened.splice(0)) {
    value.close();
    await deleteDB(value.namespace);
  }
});

describe("atomic unsigned evidence import", () => {
  it("rejects a late semantic collision without committing earlier incoming records or seals", async () => {
    const j = await journal();
    const existing = await records("existing");
    const incoming = await records("incoming");
    await j.appendRecord(existing.p);
    await j.appendRecord(existing.s);
    await j.sealEnvelope(existing.e);
    const before = await j.listRecords();
    const beforeSeals = await seals(j.namespace);

    await expect(j.importRecords(incoming.all)).rejects.toThrow(
      /different content/,
    );

    expect(await j.listRecords()).toEqual(before);
    expect(await seals(j.namespace)).toEqual(beforeSeals);
    expect(await j.listQuarantine()).toMatchObject([
      { reason: "SemanticIntentConflict", candidate: incoming.e },
    ]);
  });

  it("stores a complete unsigned graph idempotently without enabling local signing recovery", async () => {
    const j = await journal();
    const source = await records("portable");
    const original = await signedAttempt(source.e);
    const pkg = await exportPortable([...source.all, original]);

    await j.importRecords(pkg.records);
    await j.importRecords(pkg.records);

    expect(await j.listRecords()).toHaveLength(pkg.records.length);
    expect(await seals(j.namespace)).toHaveLength(1);
    const imported = (await j.listRecords("SignedAttempt"))[0];
    expect(imported).toMatchObject({
      recordScope: "portable_export",
      signedExtrinsicBytes: null,
      bytesOmissionReason: "portable_export_omits_all_signed_packets",
    });
    expect(await j.listProgress()).toEqual([]);
    expect(await j.getPreference("recovery")).toBeUndefined();
    expect(original.signedExtrinsicBytes).not.toBeNull();
  });

  it("preserves local recovery, wallet progress and fenced operation ownership", async () => {
    const j = await journal();
    const local = await records("local", "local-intent");
    const incoming = await records("incoming", "another-intent");
    await j.appendRecord(local.p);
    await j.appendRecord(local.s);
    await j.sealEnvelope(local.e);
    const lease = await j.acquireLease("local-operation", "original-tab");
    if (!lease) throw new Error("Missing lease");
    await j.appendProgress(await progress(local.e), lease);
    const recovery = { stage: "signed", signedBytes: "0x0400" };
    await j.setPreference("recovery", recovery);
    const beforeProgress = await j.listProgress();

    await j.importRecords(incoming.all);

    expect(await j.getPreference("recovery")).toEqual(recovery);
    expect(await j.listProgress()).toEqual(beforeProgress);
    await expect(j.assertLease(lease)).resolves.toBeUndefined();
    expect(await j.acquireLease("local-operation", "other-tab")).toBeNull();
  });

  it("rejects a later immutable ID collision before adding unrelated records", async () => {
    const j = await journal();
    const existing = await profile();
    await j.appendRecord(existing);
    const incoming = await sealRecord({ ...existing, recordId: "incoming" });
    const conflict = await sealRecord({
      ...existing,
      status: "blocked" as const,
    });

    await expect(j.importRecords([incoming, conflict])).rejects.toThrow(
      /different immutable content/,
    );

    expect(await j.listRecords()).toEqual([existing]);
    expect(await seals(j.namespace)).toEqual([]);
  });

  it("rejects a digest already indexed under a different immutable ID without adding the batch", async () => {
    const j = await journal();
    const incoming = await records("incoming");
    // Exercise the durable unique-index guard independently of normal record
    // hashing, which also binds recordId. Such a row can come from damaged IDB.
    const damaged = { ...incoming.s, recordId: "damaged-existing-record" };
    const db = await openDB(j.namespace);
    try {
      await db.put("records", damaged);
    } finally {
      db.close();
    }

    await expect(j.importRecords(incoming.all)).rejects.toThrow(
      /digest already identifies another immutable record ID/,
    );

    expect(await j.listRecords()).toEqual([damaged]);
    expect(await seals(j.namespace)).toEqual([]);
  });

  it("rolls back a storage failure after a record write, including the batch's semantic seal", async () => {
    const j = await journal();
    const incoming = await records("incoming");
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (
        this.name === "records" &&
        (value as CanonicalRecord).recordId === incoming.s.recordId
      )
        throw new DOMException("Synthetic disk failure", "QuotaExceededError");
      return add.call(this, value, key);
    });

    await expect(j.importRecords(incoming.all)).rejects.toThrow(
      "Synthetic disk failure",
    );

    expect(await j.listRecords()).toEqual([]);
    expect(await seals(j.namespace)).toEqual([]);
  });

  it("rejects different incoming semantics for the same intent revision without any partial graph", async () => {
    const j = await journal();
    const first = await records("first");
    const second = await records("second");

    await expect(
      j.importRecords([...first.all, ...second.all]),
    ).rejects.toThrow(/different content/);

    expect(await j.listRecords()).toEqual([]);
    expect(await seals(j.namespace)).toEqual([]);
  });

  it("accepts a full record revision that preserves the existing sealed semantic identity", async () => {
    const j = await journal();
    const incoming = await records("original");
    await j.importRecords(incoming.all);
    const revised = await sealRecord({
      ...incoming.e,
      recordId: "revised-envelope",
      status: "stale" as const,
      derivedFromRecordDigest: incoming.e.digest,
    });

    await j.importRecords([incoming.p, incoming.s, revised]);

    expect(await j.listRecords()).toHaveLength(4);
    expect(await seals(j.namespace)).toMatchObject([
      { recordId: incoming.e.recordId },
    ]);
  });

  it("validates every digest before committing an earlier valid record", async () => {
    const j = await journal();
    const incoming = await records("incoming");
    const tampered = { ...incoming.s, digest: "00".repeat(32) };

    await expect(j.importRecords([incoming.p, tampered])).rejects.toThrow(
      /invalid digest/,
    );

    expect(await j.listRecords()).toEqual([]);
  });

  it("refuses local signed packets, including a packet relabelled as a portable export", async () => {
    const j = await journal();
    const incoming = await records("incoming");
    const local = await signedAttempt(incoming.e);

    await expect(j.importRecords([...incoming.all, local])).rejects.toThrow();
    const relabelled = await sealRecord({
      ...local,
      recordScope: "portable_export" as const,
    });
    await expect(
      j.importRecords([...incoming.all, relabelled]),
    ).rejects.toThrow();

    expect(await j.listRecords()).toEqual([]);
    expect(await j.listProgress()).toEqual([]);
  });

  it("refuses local progress and incomplete record graphs", async () => {
    const j = await journal();
    const incoming = await records("incoming");
    await expect(
      j.importRecords([
        incoming.p,
        (await progress(incoming.e)) as unknown as CanonicalRecord,
      ]),
    ).rejects.toThrow();
    await expect(j.importRecords([incoming.e])).rejects.toThrow(/requires/);
    expect(await j.listRecords()).toEqual([]);
  });

  it("serializes conflicting imports from separate handles without mixing their record graphs", async () => {
    const j = await journal();
    const other = await openJournal(j.namespace);
    opened.push(other);
    const first = await records("first");
    const second = await records("second");

    const result = await Promise.allSettled([
      j.importRecords(first.all),
      other.importRecords(second.all),
    ]);

    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(result.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
    const stored = await j.listRecords();
    const winner = result[0]?.status === "fulfilled" ? first : second;
    expect(stored.map((record) => record.recordId).sort()).toEqual(
      winner.all.map((record) => record.recordId).sort(),
    );
    expect(await seals(j.namespace)).toHaveLength(1);
    expect(await j.listQuarantine()).toHaveLength(1);
  });

  it("snapshots caller-owned records before asynchronous integrity validation", async () => {
    const j = await journal();
    const original = await profile();
    const pending = j.importRecords([original]);
    original.status = "blocked";
    await pending;

    expect((await j.getRecord(original.recordId))?.kind).toBe("ChainProfile");
    expect(await j.getRecord(original.recordId)).toMatchObject({
      status: "candidate",
    });
  });

  it("publishes restored workspace metadata atomically and rolls back a failed selection write", async () => {
    const j = await journal();
    const original = [{ id: "existing-workspace", name: "Existing" }];
    await j.setPreference("workspaces", original);
    await j.setPreference("currentId", "existing-workspace");
    const restored = [
      ...original,
      { id: "restored-workspace", name: "Restored" },
    ];
    const put = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "preferences" && key === "currentId")
          throw new DOMException(
            "Synthetic selection write failure",
            "QuotaExceededError",
          );
        return put.call(this, value, key);
      });

    await expect(
      j.setPreferences({
        workspaces: restored,
        currentId: "restored-workspace",
      }),
    ).rejects.toThrow("Synthetic selection write failure");

    expect(await j.getPreference("workspaces")).toEqual(original);
    expect(await j.getPreference("currentId")).toBe("existing-workspace");
    fault.mockRestore();
    await j.setPreferences({
      workspaces: restored,
      currentId: "restored-workspace",
    });
    expect(await j.getPreference("workspaces")).toEqual(restored);
    expect(await j.getPreference("currentId")).toBe("restored-workspace");
  });
});
