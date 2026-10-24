import {
  validateRecordSchema,
  validateProgressSchema,
  validatePackageSchema,
  validateIntentSchema,
  validateCallTreeSchema,
} from "../generated/validators.js";
import { ContractError } from "./errors.js";
import type {
  CanonicalRecord,
  LocalOperationProgress,
  PortablePackage,
  Intent,
  CallTree,
  ReviewedSigningContext,
} from "./records.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { parseBoundedJson } from "./bounded-parser.js";

type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Validator = ((input: unknown) => boolean) & {
  errors?: Array<{ instancePath: string; message?: string }> | null;
};

function validate<T>(validator: Validator, input: unknown): Validation<T> {
  if (validator(input)) return { ok: true, value: input as T };
  return {
    ok: false,
    errors: (validator.errors ?? []).map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    ),
  };
}

export function validateRecord(input: unknown): Validation<CanonicalRecord> {
  return validate(validateRecordSchema, input);
}
export function validateLocalProgress(
  input: unknown,
): Validation<LocalOperationProgress> {
  return validate(validateProgressSchema, input);
}
export function validatePortablePackage(
  input: unknown,
): Validation<PortablePackage> {
  return validate(validatePackageSchema, input);
}
export function validateIntentStructure(input: unknown): Validation<Intent> {
  return validate(validateIntentSchema, input);
}
export function validateCallTree(input: unknown): Validation<CallTree> {
  return validate(validateCallTreeSchema, input);
}

export function requireRecord(input: unknown): CanonicalRecord {
  const result = validateRecord(input);
  if (!result.ok)
    throw new ContractError(
      "InvalidRecord",
      "Record does not satisfy the current schema",
      result.errors,
    );
  return result.value;
}

function rawBytes(hex: string): Uint8Array {
  if (!/^0x(?:[a-f0-9]{2})*$/.test(hex))
    throw new ContractError(
      "InvalidHex",
      "Signing context contains invalid bytes",
    );
  return Uint8Array.from(hex.slice(2).match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

export async function verifyReviewedSigningContext(
  context: ReviewedSigningContext,
): Promise<void> {
  const parsed = parseBoundedJson(context.originalSignPayloadJcsUtf8, {
    maxBytes: 262144,
  });
  if (canonicalJson(parsed) !== context.originalSignPayloadJcsUtf8)
    throw new ContractError(
      "NoncanonicalWalletRequest",
      "Wallet request text is not canonical",
    );
  if (
    (await sha256(context.originalSignPayloadJcsUtf8)) !==
    context.signPayloadSha256
  )
    throw new ContractError(
      "SigningContextDigestMismatch",
      "Wallet request digest does not match",
    );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ContractError(
      "InvalidWalletRequest",
      "Wallet request must be an object",
    );
  const payload = parsed as Record<string, unknown>;
  const required = [
    "address",
    "blockHash",
    "blockNumber",
    "era",
    "genesisHash",
    "method",
    "nonce",
    "specVersion",
    "tip",
    "transactionVersion",
    "signedExtensions",
    "version",
    "withSignedTransaction",
  ];
  const allowed = [...required, "assetId", "metadataHash", "mode"];
  if (
    required.some((key) => !(key in payload)) ||
    Object.keys(payload).some((key) => !allowed.includes(key))
  )
    throw new ContractError(
      "InvalidWalletRequest",
      "Wallet payload fields are missing or unsupported",
    );
  for (const [field, expected] of [
    ["address", context.signer],
    ["blockHash", context.mortalityBlockHash],
    ["genesisHash", context.genesis],
    ["method", context.outerCallBytes],
    ["era", context.era],
  ] as const) {
    if (payload[field] !== expected)
      throw new ContractError(
        "SigningContextMismatch",
        `Wallet ${field} differs from its reviewed context`,
      );
  }
  for (const [field, expected] of [
    ["nonce", context.nonce],
    ["specVersion", context.specVersion],
    ["transactionVersion", context.transactionVersion],
    ["tip", context.tipNative],
  ] as const) {
    const value = payload[field];
    if (
      typeof value !== "string" ||
      !/^0x[0-9a-f]+$/i.test(value) ||
      BigInt(value) !== BigInt(expected)
    )
      throw new ContractError(
        "SigningContextMismatch",
        `Wallet ${field} differs from its reviewed context`,
      );
  }
  if (
    payload.version !== Number(context.extrinsicVersion) ||
    payload.withSignedTransaction !== false ||
    canonicalJson(payload.signedExtensions) !==
      canonicalJson(context.signedExtensions)
  )
    throw new ContractError(
      "SigningContextMismatch",
      "Wallet version, extension set or signature-only policy differs",
    );
  if (payload.assetId !== undefined || context.feeAssetId !== null)
    throw new ContractError(
      "UnsupportedFeeAsset",
      "Only native fee payment is supported",
    );
  if ((payload.metadataHash ?? null) !== context.metadataHashExtensionValue)
    throw new ContractError(
      "SigningContextMismatch",
      "Metadata hash extension differs",
    );
  if (
    (await sha256(rawBytes(context.additionalSignedPayloadBytes))) !==
    context.additionalSignedContextSha256
  )
    throw new ContractError(
      "SigningContextDigestMismatch",
      "Additional-signed context digest differs",
    );
}

export async function verifySigningContext(
  progress: LocalOperationProgress,
): Promise<void> {
  const context = progress.reviewedSigningContext;
  if (context === null) {
    if (progress.phase !== "Prepared")
      throw new ContractError(
        "MissingSigningContext",
        "Wallet phase requires exact durable context",
      );
    return;
  }
  await verifyReviewedSigningContext(context);
  if (
    progress.reviewedRequestDigest !== context.signPayloadSha256 ||
    progress.requestedSigner !== context.signer ||
    progress.requestId !== context.requestId
  )
    throw new ContractError(
      "SigningContextMismatch",
      "Progress does not reference its exact reviewed request",
    );
  if (
    progress.outerCallSha256 !==
    (await sha256(rawBytes(context.outerCallBytes)))
  )
    throw new ContractError(
      "SigningContextDigestMismatch",
      "Reviewed outer-call digest differs",
    );
}
