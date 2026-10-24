import { ContractError } from "./errors.js";
import { parseBoundedJson, PORTABLE_LIMITS } from "./bounded-parser.js";
import { canonicalJson, sealRecord } from "./canonical.js";
import { validatePortablePackage, requireRecord } from "./validation.js";
import { semanticConflict, validateRecordSemantics } from "./semantics.js";
import type {
  CanonicalRecord,
  FrozenEnvelope,
  PortablePackage,
} from "./records.js";

export interface ImportedPackage {
  package: PortablePackage;
  records: CanonicalRecord[];
  needsReconciliation: true;
}

function dependencies(record: CanonicalRecord): Array<{
  field: string;
  value: string;
  kind: CanonicalRecord["kind"];
  by: "id" | "digest";
}> {
  const refs: Array<{
    field: string;
    value: string;
    kind: CanonicalRecord["kind"];
    by: "id" | "digest";
  }> = [];
  if ("profileDigest" in record)
    refs.push({
      field: "profileDigest",
      value: record.profileDigest,
      kind: "ChainProfile",
      by: "digest",
    });
  if (record.kind === "FrozenEnvelope") {
    refs.push({
      field: "intent.profileDigest",
      value: record.intent.profileDigest,
      kind: "ChainProfile",
      by: "digest",
    });
    refs.push({
      field: "intent.expectedState.snapshotDigest",
      value: record.intent.expectedState.snapshotDigest,
      kind: "Snapshot",
      by: "digest",
    });
  }
  if (record.kind === "SignedAttempt") {
    refs.push({
      field: "envelopeDigest",
      value: record.envelopeDigest,
      kind: "FrozenEnvelope",
      by: "digest",
    });
    if (record.reviewedSigningContext.nativeProposalDigest)
      refs.push({
        field: "reviewedSigningContext.nativeProposalDigest",
        value: record.reviewedSigningContext.nativeProposalDigest,
        kind: "NativeProposal",
        by: "digest",
      });
  }
  if (record.kind === "ReceiptBundle")
    refs.push({
      field: "signedAttemptId",
      value: record.signedAttemptId,
      kind: "SignedAttempt",
      by: "id",
    });
  if (record.kind === "ContinuityCertificate") {
    if (record.removalReceiptId)
      refs.push({
        field: "removalReceiptId",
        value: record.removalReceiptId,
        kind: "ReceiptBundle",
        by: "id",
      });
    if (record.milestone1SubmissionReceiptId)
      refs.push({
        field: "milestone1SubmissionReceiptId",
        value: record.milestone1SubmissionReceiptId,
        kind: "ReceiptBundle",
        by: "id",
      });
  }
  return refs;
}

export function assertGraphClosure(records: readonly CanonicalRecord[]): void {
  const ids = new Map<string, CanonicalRecord>();
  const digests = new Map<string, CanonicalRecord>();
  for (const record of records) {
    if (ids.has(record.recordId) || digests.has(record.digest))
      throw new ContractError(
        "DuplicateRecord",
        "Portable graph has duplicate record IDs or digests",
      );
    ids.set(record.recordId, record);
    digests.set(record.digest, record);
  }
  for (const record of records)
    for (const ref of dependencies(record)) {
      const target = (ref.by === "id" ? ids : digests).get(ref.value);
      if (!target || target.kind !== ref.kind)
        throw new ContractError(
          "BrokenRecordReference",
          `${record.recordId}.${ref.field} requires a ${ref.kind} in the exported graph`,
        );
      if (
        "profileId" in record &&
        "profileId" in target &&
        record.profileId !== target.profileId
      )
        throw new ContractError(
          "ProfileReferenceMismatch",
          "Record reference crosses profile identities",
        );
    }
  for (const record of records) {
    if (record.kind === "SignedAttempt") {
      const envelope = digests.get(record.envelopeDigest);
      if (
        envelope?.kind !== "FrozenEnvelope" ||
        record.intentId !== envelope.intent.intentId ||
        record.profileDigest !== envelope.intent.profileDigest ||
        !envelope.requiredSigners.includes(record.signer)
      ) {
        throw new ContractError(
          "AttemptReferenceMismatch",
          "Signed attempt does not match the referenced intent, profile and signer",
        );
      }
    }
    if (record.kind === "ReceiptBundle") {
      const attempt = ids.get(record.signedAttemptId);
      const envelope =
        attempt?.kind === "SignedAttempt"
          ? digests.get(attempt.envelopeDigest)
          : undefined;
      if (
        attempt?.kind !== "SignedAttempt" ||
        envelope?.kind !== "FrozenEnvelope" ||
        record.extrinsicHash !== attempt.signedExtrinsicHash ||
        record.intentId !== attempt.intentId ||
        record.profileDigest !== attempt.profileDigest ||
        record.operationId !== envelope.intent.operationId
      ) {
        throw new ContractError(
          "ReceiptReferenceMismatch",
          "Receipt does not match its exact attempt and operation",
        );
      }
    }
    if (
      record.kind === "ContinuityCertificate" &&
      ["verified", "historically_verified_current_drift"].includes(
        record.verdict,
      )
    ) {
      const removal = record.removalReceiptId
        ? ids.get(record.removalReceiptId)
        : undefined;
      const continuation = record.milestone1SubmissionReceiptId
        ? ids.get(record.milestone1SubmissionReceiptId)
        : undefined;
      if (
        removal?.kind !== "ReceiptBundle" ||
        continuation?.kind !== "ReceiptBundle" ||
        removal.operationId !== "GRC-ROTATION-REMOVE-M0" ||
        continuation.operationId !== "GRC-GRANT-SUBMIT-M1" ||
        removal.profileDigest !== record.profileDigest ||
        continuation.profileDigest !== record.profileDigest
      ) {
        throw new ContractError(
          "CertificateReferenceMismatch",
          "Continuity requires distinct exact removal and continuation receipts for this profile",
        );
      }
    }
  }
}

export async function importPortable(
  input: string | Uint8Array,
  existingEnvelopes: readonly FrozenEnvelope[] = [],
): Promise<ImportedPackage> {
  const raw = parseBoundedJson(input);
  const checked = validatePortablePackage(raw);
  if (!checked.ok)
    throw new ContractError(
      "UnsupportedPackage",
      "Package must contain current unsigned canonical records",
      checked.errors,
    );
  const pkg = checked.value;
  assertGraphClosure(pkg.records);
  for (const record of pkg.records) {
    const issues = await validateRecordSemantics(record);
    if (issues.length)
      throw new ContractError(
        "InvalidRecordSemantics",
        "Imported record failed consistency checks",
        issues.map((issue) => `${issue.guardId}: ${issue.message}`),
      );
  }
  for (const remap of pkg.recordIdentityMap) {
    const record = pkg.records.find(
      (candidate) => candidate.recordId === remap.newRecordId,
    );
    if (
      !record ||
      record.digest !== remap.newDigest ||
      record.derivedFromRecordDigest !== remap.oldDigest
    )
      throw new ContractError(
        "InvalidIdentityMap",
        "Portable identity map does not match record lineage",
      );
  }
  for (const field of [
    "oldRecordId",
    "oldDigest",
    "newRecordId",
    "newDigest",
  ] as const) {
    const values = pkg.recordIdentityMap.map((entry) => entry[field]);
    if (new Set(values).size !== values.length)
      throw new ContractError(
        "AmbiguousIdentityMap",
        `Duplicate ${field} in portable identity map`,
      );
  }
  const incomingEnvelopes = pkg.records.filter(
    (record): record is FrozenEnvelope => record.kind === "FrozenEnvelope",
  );
  if (semanticConflict([...existingEnvelopes, ...incomingEnvelopes]))
    throw new ContractError(
      "SemanticIntentConflict",
      "Import conflicts with an existing intent revision",
    );
  return { package: pkg, records: pkg.records, needsReconciliation: true };
}

const exportOrder: Record<CanonicalRecord["kind"], number> = {
  ChainProfile: 0,
  Snapshot: 1,
  NativeProposal: 2,
  FrozenEnvelope: 3,
  SignedAttempt: 4,
  ReceiptBundle: 5,
  ContinuityCertificate: 6,
};

export async function exportPortable(
  input: readonly CanonicalRecord[],
  sourceInputs: PortablePackage["sourceInputs"] = [],
): Promise<PortablePackage> {
  if (!input.length || input.length > PORTABLE_LIMITS.maxRecordItems)
    throw new ContractError(
      "InvalidExportSize",
      "Export requires 1–1,000 records",
    );
  assertGraphClosure(input);
  for (const record of input) {
    requireRecord(record);
    const issues = await validateRecordSemantics(record);
    if (issues.length)
      throw new ContractError(
        "InvalidRecordSemantics",
        "Cannot export inconsistent records",
        issues.map((issue) => issue.message),
      );
  }
  const ids = new Map<string, string>();
  const digests = new Map<string, string>();
  const records: CanonicalRecord[] = [];
  const recordIdentityMap: PortablePackage["recordIdentityMap"] = [];
  for (const original of [...input].sort(
    (a, b) => exportOrder[a.kind] - exportOrder[b.kind],
  )) {
    let record = structuredClone(original);
    let changed = false;
    const mutable = record as unknown as Record<string, unknown>;
    for (const ref of dependencies(original)) {
      const remap = (ref.by === "id" ? ids : digests).get(ref.value);
      if (!remap || remap === ref.value) continue;
      const segments = ref.field.split(".");
      let target = mutable;
      for (const segment of segments.slice(0, -1))
        target = target[segment] as Record<string, unknown>;
      target[segments.at(-1)!] = remap;
      changed = true;
    }
    const redact =
      record.kind === "SignedAttempt" &&
      record.recordScope !== "portable_export";
    if (record.kind === "SignedAttempt") {
      if (record.signedExtrinsicBytes !== null) changed = true;
      record.signedExtrinsicBytes = null;
      record.bytesOmissionReason = "portable_export_omits_all_signed_packets";
      record.recordScope = "portable_export";
    }
    if (changed || redact) {
      const newId = `portable-${globalThis.crypto.randomUUID()}`;
      record.recordId = newId;
      record.derivedFromRecordDigest = original.digest;
      record = await sealRecord(record);
      ids.set(original.recordId, newId);
      digests.set(original.digest, record.digest);
      recordIdentityMap.push({
        oldRecordId: original.recordId,
        oldDigest: original.digest,
        newRecordId: newId,
        newDigest: record.digest,
        reason: redact ? "signed_bytes_redaction" : "reference_remap",
      });
    }
    records.push(record);
  }
  const pkg: PortablePackage = {
    format: "grc.native-record-package",
    version: "2",
    scope: "portable_unsigned_evidence",
    records,
    recordIdentityMap,
    sourceInputs,
    localContractRevision: "grc-v2-local-1",
  };
  assertGraphClosure(records);
  const checked = validatePortablePackage(pkg);
  if (!checked.ok)
    throw new ContractError(
      "InvalidExport",
      "Redacted package failed schema validation",
      checked.errors,
    );
  parseBoundedJson(canonicalJson(pkg));
  return pkg;
}
