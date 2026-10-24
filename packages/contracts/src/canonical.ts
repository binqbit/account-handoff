import canonicalize from "canonicalize";
import { ContractError } from "./errors.js";
import type { CanonicalRecord, FrozenEnvelope, Sha256 } from "./records.js";
import { assertUnicode } from "./bounded-parser.js";

function checkValue(value: unknown, ancestors = new Set<object>()): void {
  if (typeof value === "string") assertUnicode(value);
  else if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new ContractError(
      "UnsafeNumber",
      "Nonfinite or imprecise JSON number",
    );
  else if (
    typeof value === "bigint" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "function"
  )
    throw new ContractError(
      "NonJsonValue",
      "Value cannot be canonically serialized",
    );
  else if (value !== null && typeof value === "object") {
    if (ancestors.has(value))
      throw new ContractError(
        "CyclicValue",
        "Cyclic value cannot be canonical JSON",
      );
    const proto = Object.getPrototypeOf(value) as unknown;
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
      throw new ContractError(
        "NonJsonValue",
        "Only plain objects and arrays are supported",
      );
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) {
      assertUnicode(key);
      checkValue(child, ancestors);
    }
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  checkValue(value);
  const text = canonicalize(value);
  if (text === undefined)
    throw new ContractError(
      "NonJsonValue",
      "Canonicalization returned no value",
    );
  return text;
}

export async function sha256(bytes: Uint8Array | string): Promise<Sha256> {
  const input =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const stable = Uint8Array.from(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stable);
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

export async function recordDigest(record: object): Promise<Sha256> {
  const projection = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "digest"),
  );
  return sha256(canonicalJson(projection));
}

export async function sealRecord<T extends object>(
  record: T,
): Promise<T & { digest: Sha256 }> {
  return { ...record, digest: await recordDigest(record) };
}

export async function verifyRecordDigest(
  record: CanonicalRecord,
): Promise<boolean> {
  return (await recordDigest(record)) === record.digest;
}

export function semanticIntentProjection(envelope: FrozenEnvelope): object {
  const { intent, resources } = envelope;
  const grant = intent.expectedState.grantContext;
  return {
    domain: "grc.semantic-intent:1",
    localContractRevision: envelope.localContractRevision,
    intentId: intent.intentId,
    intentRevision: intent.intentRevision,
    operationId: intent.operationId,
    profileId: intent.profileId,
    profileDigest: intent.profileDigest,
    authorActor: intent.authorActor,
    parameters: intent.parameters,
    expectedAuthority: intent.expectedState.authority,
    signingPath: envelope.signingPath,
    controller: envelope.controller,
    requiredSigners: envelope.requiredSigners,
    participants: envelope.participants,
    innerRuntimeCallBytes: envelope.innerRuntimeCallBytes,
    innerRuntimeCallHash: envelope.innerRuntimeCallHash,
    innerResources: {
      valueNative: resources.valueNative,
      reviveWeight: resources.reviveWeight,
      storageDepositLimitNative: resources.storageDepositLimitNative,
    },
    expectedGrant:
      grant === null
        ? null
        : {
            grantId: grant.grantId,
            milestoneIndex: grant.milestoneIndex,
            reviewedExpectedRound: grant.reviewedExpectedRound,
            roundBinding: grant.roundBinding,
            observedMilestoneState: grant.observedMilestoneState,
            deadlineUnixSeconds: grant.deadlineUnixSeconds,
            evidenceSha256: grant.evidenceSha256,
          },
  };
}

export async function semanticIntentDigest(
  envelope: FrozenEnvelope,
): Promise<Sha256> {
  return sha256(canonicalJson(semanticIntentProjection(envelope)));
}
