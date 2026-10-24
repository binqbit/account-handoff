import { describe, expect, it } from "vitest";
import {
  validateRecord,
  validateLocalProgress,
  verifySigningContext,
} from "@account-handoff/contracts";
import {
  DIGEST,
  HASH,
  evidence,
  envelope,
  profile,
  progress,
  signedAttempt,
  snapshot,
} from "../../fixtures/core.js";

describe("canonical structural boundary", () => {
  it("validates the current typed record constructors and rejects unknown fields", async () => {
    const p = await profile(),
      s = await snapshot(p),
      e = await envelope(p, s),
      a = await signedAttempt(e);
    for (const record of [p, s, e, a])
      expect(validateRecord(record), record.kind).toEqual({
        ok: true,
        value: record,
      });
    expect(validateRecord({ ...e, privateKey: "forbidden" }).ok).toBe(false);
    expect(validateRecord({ ...e, localContractRevision: "legacy" }).ok).toBe(
      false,
    );
  });
  it("SG-30: exact pre-wallet context is required without a fabricated signed hash", async () => {
    const p = await profile(),
      e = await envelope(p, await snapshot(p));
    const local = await progress(e);
    expect(validateLocalProgress(local).ok).toBe(true);
    await expect(verifySigningContext(local)).resolves.toBeUndefined();
    expect(
      validateLocalProgress({ ...local, reviewedSigningContext: null }).ok,
    ).toBe(false);
    local.reviewedSigningContext!.originalSignPayloadJcsUtf8 =
      '{"version":"4"}';
    await expect(verifySigningContext(local)).rejects.toThrow();
  });
  it("does not accept a version string as runtime qualification", async () => {
    const p = await profile();
    expect(validateRecord({ ...p, status: "accepted" }).ok).toBe(false);
  });
  it("binds current LOCAL metadata without relaxing the separate remote target contract", async () => {
    const p = await profile();
    const qualified = {
      ...p,
      status: "accepted",
      genesis: HASH,
      runtimeCodeHash: HASH,
      metadataSha256: DIGEST,
      specVersion: "1",
      transactionVersion: "1",
      specName: "account-handoff-local",
      metadataVersion: "16",
      bindingEvidence: {
        ...p.bindingEvidence,
        rawMetadataEvidence: evidence,
        rawRuntimeCodeEvidence: evidence,
        runtimeSourceBuildRelationship: evidence,
        generatedNativeTypesSha256: DIGEST,
      },
    };
    expect(validateRecord(qualified).ok).toBe(true);
    expect(validateRecord({ ...qualified, specName: "portaldot" }).ok).toBe(
      false,
    );
    expect(
      validateRecord({ ...qualified, bindingEvidence: p.bindingEvidence }).ok,
    ).toBe(false);
  });
});
