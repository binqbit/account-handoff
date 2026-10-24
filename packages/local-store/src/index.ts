import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  ContractError,
  canonicalJson,
  requireRecord,
  validateLocalProgress,
  verifyRecordDigest,
  verifySigningContext,
  semanticIntentDigest,
} from "@account-handoff/contracts";
import type {
  CanonicalRecord,
  FrozenEnvelope,
  LocalOperationProgress,
  SignedAttempt,
} from "@account-handoff/contracts";

export interface Lease {
  scope: string;
  owner: string;
  generation: number;
  expiresAt: number;
}
interface SemanticSeal {
  key: string;
  digest: string;
  recordId: string;
}
interface QuarantineItem {
  id: string;
  reason: string;
  candidate: unknown;
  at: number;
}
export interface LocalObservation {
  observationId: string;
  requestId: string;
  at: number;
  kind: string;
  data: unknown;
}
interface JournalSchema extends DBSchema {
  records: {
    key: string;
    value: CanonicalRecord;
    indexes: { kind: string; digest: string };
  };
  localProgress: {
    key: string;
    value: LocalOperationProgress;
    indexes: { requestId: string; envelopeDigest: string };
  };
  semanticSeals: { key: string; value: SemanticSeal };
  leases: { key: string; value: Lease };
  quarantine: { key: string; value: QuarantineItem };
  observations: {
    key: string;
    value: LocalObservation;
    indexes: { requestId: string };
  };
  preferences: { key: string; value: unknown };
  recordLinks: {
    key: string;
    value: { fromId: string; relation: string; toId: string };
  };
  projectionCache: { key: string; value: unknown };
  profiles: { key: string; value: CanonicalRecord };
  proposalIndex: { key: string; value: unknown };
}

export interface Journal {
  readonly namespace: string;
  appendRecord(record: CanonicalRecord): Promise<void>;
  sealEnvelope(record: FrozenEnvelope): Promise<void>;
  appendProgress(
    progress: LocalOperationProgress,
    lease?: Lease,
  ): Promise<void>;
  recordSignedAttempt(attempt: SignedAttempt, lease: Lease): Promise<void>;
  listRecords(kind?: CanonicalRecord["kind"]): Promise<CanonicalRecord[]>;
  getRecord(id: string): Promise<CanonicalRecord | undefined>;
  getRecordByDigest(digest: string): Promise<CanonicalRecord | undefined>;
  listProgress(requestId?: string): Promise<LocalOperationProgress[]>;
  appendObservation(observation: LocalObservation): Promise<void>;
  listObservations(requestId?: string): Promise<LocalObservation[]>;
  acquireLease(
    scope: string,
    owner: string,
    ttlMs?: number,
  ): Promise<Lease | null>;
  assertLease(lease: Lease): Promise<void>;
  releaseLease(lease: Lease): Promise<void>;
  getPreference<T>(key: string): Promise<T | undefined>;
  setPreference(key: string, value: unknown): Promise<void>;
  listQuarantine(): Promise<QuarantineItem[]>;
  close(): void;
}

async function abortWith(
  tx: { abort(): void; done: Promise<void> },
  error: Error,
): Promise<never> {
  tx.abort();
  try {
    await tx.done;
  } catch {
    /* The caller receives the domain failure; consume the transaction abort. */
  }
  throw error;
}

function keyForEnvelope(envelope: FrozenEnvelope): string {
  return `${envelope.intent.intentId}:${envelope.intent.intentRevision}`;
}
async function validateRecordIntegrity(record: CanonicalRecord): Promise<void> {
  requireRecord(record);
  if (!(await verifyRecordDigest(record)))
    throw new ContractError(
      "RecordDigestMismatch",
      "Cannot store a record with an invalid digest",
    );
}

export async function openJournal(
  namespace: string,
  options: {
    now?: () => number;
    blocked?: () => void;
    terminated?: () => void;
  } = {},
): Promise<Journal> {
  if (
    !/^account-handoff:(?:live|demo|local|fixture):[A-Za-z0-9:._-]{1,240}$/.test(
      namespace,
    )
  )
    throw new ContractError(
      "InvalidNamespace",
      "Journal requires an isolated runtime namespace",
    );
  const now = options.now ?? Date.now;
  const db: IDBPDatabase<JournalSchema> = await openDB<JournalSchema>(
    namespace,
    1,
    {
      upgrade(database) {
        const records = database.createObjectStore("records", {
          keyPath: "recordId",
        });
        records.createIndex("kind", "kind");
        records.createIndex("digest", "digest", { unique: true });
        const progress = database.createObjectStore("localProgress", {
          keyPath: "journalId",
        });
        progress.createIndex("requestId", "requestId");
        progress.createIndex("envelopeDigest", "envelopeDigest");
        database.createObjectStore("semanticSeals", { keyPath: "key" });
        database.createObjectStore("leases", { keyPath: "scope" });
        database.createObjectStore("quarantine", { keyPath: "id" });
        const observations = database.createObjectStore("observations", {
          keyPath: "observationId",
        });
        observations.createIndex("requestId", "requestId");
        database.createObjectStore("preferences");
        database.createObjectStore("recordLinks");
        database.createObjectStore("projectionCache");
        database.createObjectStore("profiles");
        database.createObjectStore("proposalIndex");
      },
      blocked() {
        options.blocked?.();
      },
      blocking() {
        db.close();
      },
      terminated() {
        options.terminated?.();
      },
    },
  );
  const assertCurrentLease = (
    current: Lease | undefined,
    expected: Lease,
  ): void => {
    if (
      !current ||
      current.owner !== expected.owner ||
      current.generation !== expected.generation ||
      current.expiresAt <= now()
    )
      throw new ContractError(
        "StaleLease",
        "The current tab no longer owns this operation",
      );
  };
  return {
    namespace,
    async appendRecord(record) {
      await validateRecordIntegrity(record);
      if (
        record.kind === "SignedAttempt" &&
        record.recordScope === "local_journal"
      )
        throw new ContractError(
          "GuardedStoreRequired",
          "Signed attempts require the durable wallet context and fenced recordSignedAttempt method",
        );
      if (record.kind === "FrozenEnvelope" && record.status !== "draft")
        throw new ContractError(
          "SealedStoreRequired",
          "Sealed envelopes require semantic conflict checking through sealEnvelope",
        );
      const tx = db.transaction("records", "readwrite", {
        durability: "strict",
      });
      const existing = await tx.store.get(record.recordId);
      if (existing && existing.digest !== record.digest) {
        return abortWith(
          tx,
          new ContractError(
            "ImmutableRecordConflict",
            "Record ID already identifies different immutable content",
          ),
        );
      }
      if (!existing) await tx.store.add(record);
      await tx.done;
    },
    async sealEnvelope(envelope) {
      await validateRecordIntegrity(envelope);
      if (
        !envelope.semanticIntentDigest ||
        envelope.semanticIntentDigest !== (await semanticIntentDigest(envelope))
      )
        throw new ContractError(
          "SemanticDigestMismatch",
          "Envelope semantic identity is not sealed",
        );
      const key = keyForEnvelope(envelope);
      const tx = db.transaction(
        ["records", "semanticSeals", "quarantine"],
        "readwrite",
        { durability: "strict" },
      );
      const seal = await tx.objectStore("semanticSeals").get(key);
      if (seal && seal.digest !== envelope.semanticIntentDigest) {
        await tx.objectStore("quarantine").put({
          id: envelope.recordId,
          reason: "SemanticIntentConflict",
          candidate: envelope,
          at: now(),
        });
        await tx.done;
        throw new ContractError(
          "SemanticIntentConflict",
          "The same intent revision already has different content",
        );
      }
      const existing = await tx.objectStore("records").get(envelope.recordId);
      if (existing && existing.digest !== envelope.digest) {
        return abortWith(
          tx,
          new ContractError("ImmutableRecordConflict", "Envelope ID conflict"),
        );
      }
      if (!existing) await tx.objectStore("records").add(envelope);
      if (!seal)
        await tx.objectStore("semanticSeals").add({
          key,
          digest: envelope.semanticIntentDigest,
          recordId: envelope.recordId,
        });
      await tx.done;
    },
    async appendProgress(progress, lease) {
      const checked = validateLocalProgress(progress);
      if (!checked.ok)
        throw new ContractError(
          "InvalidProgress",
          "Invalid local operation progress",
          checked.errors,
        );
      await verifySigningContext(progress);
      if (progress.phase === "WalletRequested" && !lease)
        throw new ContractError(
          "MissingLease",
          "Wallet requests require fenced local ownership",
        );
      const tx = db.transaction(
        ["records", "localProgress", "leases"],
        "readwrite",
        { durability: "strict" },
      );
      if (progress.phase === "WalletRequested" && lease) {
        try {
          assertCurrentLease(
            await tx.objectStore("leases").get(lease.scope),
            lease,
          );
        } catch (error) {
          return abortWith(
            tx,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
      const envelope = await tx
        .objectStore("records")
        .index("digest")
        .get(progress.envelopeDigest);
      if (
        envelope?.kind !== "FrozenEnvelope" ||
        envelope.intent.intentId !== progress.intentId
      ) {
        return abortWith(
          tx,
          new ContractError(
            "MissingEnvelope",
            "Progress requires the exact stored envelope",
          ),
        );
      }
      if (
        envelope.intent.profileId !== progress.profileId ||
        envelope.intent.profileDigest !== progress.profileDigest
      )
        return abortWith(
          tx,
          new ContractError(
            "ProfileMismatch",
            "Progress belongs to a different profile revision",
          ),
        );
      if (progress.reviewedSigningContext) {
        const phase = progress.reviewedSigningContext.operationPhase;
        const expectedSigner =
          envelope.requiredSigners[phase === "multisig_final" ? 1 : 0];
        if (progress.requestedSigner !== expectedSigner)
          return abortWith(
            tx,
            new ContractError(
              "SignerMismatch",
              "This request is not for the required signer at this stage",
            ),
          );
      }
      const prior =
        progress.requestId === null
          ? []
          : await tx
              .objectStore("localProgress")
              .index("requestId")
              .getAll(progress.requestId);
      if (
        prior.some(
          (p) =>
            p.envelopeDigest !== progress.envelopeDigest ||
            canonicalJson(p.reviewedSigningContext) !==
              canonicalJson(progress.reviewedSigningContext),
        )
      ) {
        return abortWith(
          tx,
          new ContractError(
            "RequestContextConflict",
            "A request cannot change its envelope or signing context",
          ),
        );
      }
      const existing = await tx
        .objectStore("localProgress")
        .get(progress.journalId);
      if (existing && canonicalJson(existing) !== canonicalJson(progress)) {
        return abortWith(
          tx,
          new ContractError(
            "ImmutableProgressConflict",
            "Progress is append-only",
          ),
        );
      }
      if (!existing) await tx.objectStore("localProgress").add(progress);
      await tx.done;
    },
    async recordSignedAttempt(attempt, lease) {
      await validateRecordIntegrity(attempt);
      if (
        attempt.recordScope !== "local_journal" ||
        !attempt.signedExtrinsicBytes
      )
        throw new ContractError(
          "MissingSignedPacket",
          "The local signed attempt must retain exact bytes",
        );
      const tx = db.transaction(
        ["records", "localProgress", "leases"],
        "readwrite",
        { durability: "strict" },
      );
      assertCurrentLease(
        await tx.objectStore("leases").get(lease.scope),
        lease,
      );
      const progress = await tx
        .objectStore("localProgress")
        .index("envelopeDigest")
        .getAll(attempt.envelopeDigest);
      if (
        !progress.some(
          (p) =>
            p.phase === "WalletRequested" &&
            p.requestedSigner === attempt.signer &&
            canonicalJson(p.reviewedSigningContext) ===
              canonicalJson(attempt.reviewedSigningContext),
        )
      ) {
        return abortWith(
          tx,
          new ContractError(
            "MissingDurableWalletRequest",
            "Exact wallet request must be durably stored before its signed result",
          ),
        );
      }
      const existing = await tx.objectStore("records").get(attempt.recordId);
      if (existing && existing.digest !== attempt.digest) {
        return abortWith(
          tx,
          new ContractError(
            "ImmutableRecordConflict",
            "Signed attempt ID conflict",
          ),
        );
      }
      if (!existing) await tx.objectStore("records").add(attempt);
      await tx.done;
    },
    listRecords(kind) {
      return kind
        ? db.getAllFromIndex("records", "kind", kind)
        : db.getAll("records");
    },
    getRecord(id) {
      return db.get("records", id);
    },
    getRecordByDigest(digest) {
      return db.getFromIndex("records", "digest", digest);
    },
    listProgress(requestId) {
      return requestId
        ? db.getAllFromIndex("localProgress", "requestId", requestId)
        : db.getAll("localProgress");
    },
    async appendObservation(observation) {
      canonicalJson(observation);
      const tx = db.transaction("observations", "readwrite", {
        durability: "strict",
      });
      const existing = await tx.store.get(observation.observationId);
      if (existing && canonicalJson(existing) !== canonicalJson(observation)) {
        return abortWith(
          tx,
          new ContractError(
            "ObservationConflict",
            "Observations are append-only",
          ),
        );
      }
      if (!existing) await tx.store.add(observation);
      await tx.done;
    },
    listObservations(requestId) {
      return requestId
        ? db.getAllFromIndex("observations", "requestId", requestId)
        : db.getAll("observations");
    },
    async acquireLease(scope, owner, ttlMs = 30000) {
      if (
        !scope ||
        !owner ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1000 ||
        ttlMs > 300000
      )
        throw new ContractError(
          "InvalidLease",
          "Invalid operation lease bounds",
        );
      const tx = db.transaction("leases", "readwrite", {
        durability: "strict",
      });
      const current = await tx.store.get(scope);
      const timestamp = now();
      if (current && current.owner !== owner && current.expiresAt > timestamp) {
        await tx.done;
        return null;
      }
      const generation =
        current?.owner === owner && current.expiresAt > timestamp
          ? current.generation
          : (current?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        return abortWith(
          tx,
          new ContractError("LeaseOverflow", "Lease generation exhausted"),
        );
      }
      const lease = { scope, owner, generation, expiresAt: timestamp + ttlMs };
      await tx.store.put(lease);
      await tx.done;
      return lease;
    },
    async assertLease(lease) {
      assertCurrentLease(await db.get("leases", lease.scope), lease);
    },
    async releaseLease(lease) {
      const tx = db.transaction("leases", "readwrite", {
        durability: "strict",
      });
      const current = await tx.store.get(lease.scope);
      if (
        current?.owner === lease.owner &&
        current.generation === lease.generation
      )
        await tx.store.put({ ...current, owner: "", expiresAt: 0 });
      await tx.done;
    },
    async getPreference<T>(key: string): Promise<T | undefined> {
      return (await db.get("preferences", key)) as T | undefined;
    },
    async setPreference(key, value) {
      canonicalJson(value);
      await db.put("preferences", value, key);
    },
    listQuarantine() {
      return db.getAll("quarantine");
    },
    close() {
      db.close();
    },
  };
}
