import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { openJournal, type Journal } from "@account-handoff/local-store";
import { sealRecord, semanticIntentDigest } from "@account-handoff/contracts";
import {
  envelope,
  profile,
  progress,
  signedAttempt,
  snapshot,
} from "../fixtures/core.js";
const opened: Journal[] = [];
async function journal(now?: () => number): Promise<Journal> {
  const j = await openJournal(
    `account-handoff:fixture:${crypto.randomUUID()}`,
    now ? { now } : {},
  );
  opened.push(j);
  return j;
}
afterEach(async () => {
  for (const j of opened.splice(0)) {
    j.close();
    await deleteDB(j.namespace);
  }
});

describe("durable journal and fenced ownership", () => {
  it("enforces immutable identity and persists across reopening", async () => {
    const j = await journal(),
      p = await profile();
    await j.appendRecord(p);
    await j.appendRecord(p);
    await expect(
      j.appendRecord(await sealRecord({ ...p, status: "blocked" as const })),
    ).rejects.toThrow(/different immutable/);
    const name = j.namespace;
    j.close();
    const reopened = await openJournal(name);
    opened.push(reopened);
    expect((await reopened.getRecord(p.recordId))?.digest).toBe(p.digest);
  });
  it("SG-29: quarantines semantic collisions instead of last-write-wins", async () => {
    const j = await journal(),
      p = await profile(),
      e = await envelope(p, await snapshot(p));
    await j.sealEnvelope(e);
    const changed = structuredClone(e);
    changed.recordId = "conflict";
    changed.intent.parameters.valueNative = "11";
    changed.semanticIntentDigest = await semanticIntentDigest(changed);
    await expect(j.sealEnvelope(await sealRecord(changed))).rejects.toThrow(
      /different content/,
    );
    expect(await j.listQuarantine()).toHaveLength(1);
    expect(await j.listRecords()).toHaveLength(1);
  });
  it("SG-30: refuses a signed attempt before its exact durable wallet request", async () => {
    const j = await journal(),
      p = await profile(),
      e = await envelope(p, await snapshot(p));
    await j.sealEnvelope(e);
    const lease = await j.acquireLease("intent", "tab");
    if (!lease) throw new Error("missing lease");
    const a = await signedAttempt(e);
    await expect(j.recordSignedAttempt(a, lease)).rejects.toThrow(
      /wallet request/,
    );
    await j.appendProgress(await progress(e), lease);
    await j.recordSignedAttempt(a, lease);
    expect((await j.getRecord(a.recordId))?.kind).toBe("SignedAttempt");
    expect(
      (await j.listProgress()).find(
        (entry) => entry.phase === "SignedAttemptRecorded",
      ),
    ).toMatchObject({
      acceptedSignedAttemptId: a.recordId,
      envelopeDigest: e.digest,
      reviewedSigningContext: a.reviewedSigningContext,
    });
    await expect(j.appendRecord(a)).rejects.toThrow(/fenced/);
  });
  it("AH-OPS-05: expired tab cannot regain effects when another owner takes over", async () => {
    let time = 0;
    const j = await journal(() => time);
    const old = await j.acquireLease("operation", "tab-a", 1000);
    if (!old) throw new Error("lease");
    expect(await j.acquireLease("operation", "tab-b", 1000)).toBeNull();
    time = 1001;
    const next = await j.acquireLease("operation", "tab-b", 1000);
    if (!next) throw new Error("next lease");
    expect(next.generation).toBeGreaterThan(old.generation);
    await expect(j.assertLease(old)).rejects.toThrow(/no longer owns/);
    await expect(j.assertLease(next)).resolves.toBeUndefined();
  });
});

it("retains imported unsigned attempts as inert records without enabling the guarded local send path", async () => {
  const { exportPortable } = await import("@account-handoff/contracts");
  const j = await journal(),
    p = await profile(),
    s = await snapshot(p),
    e = await envelope(p, s),
    a = await signedAttempt(e);
  const exported = await exportPortable([p, s, e, a]);
  const inert = exported.records.find(
    (record) => record.kind === "SignedAttempt",
  );
  if (inert?.kind !== "SignedAttempt") throw new Error("missing inert attempt");
  await j.appendRecord(inert);
  const lease = await j.acquireLease("intent", "tab");
  if (!lease) throw new Error("missing lease");
  await expect(j.recordSignedAttempt(inert, lease)).rejects.toThrow(
    /exact bytes/,
  );
});
