import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  recordDigest,
  semanticIntentDigest,
  sha256,
} from "@account-handoff/contracts";
import { envelope, profile, snapshot } from "../../fixtures/core.js";

describe("canonical record identity", () => {
  it("GC-U01: uses deterministic JCS ordering and the independent SHA-256 abc vector", async () => {
    expect(canonicalJson({ z: "é", a: 1, nested: { b: false, a: null } })).toBe(
      '{"a":1,"nested":{"a":null,"b":false},"z":"é"}',
    );
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      await recordDigest({ digest: "first", nested: { digest: "kept" } }),
    ).toBe(
      await recordDigest({ digest: "second", nested: { digest: "kept" } }),
    );
    expect(await recordDigest({ nested: { digest: "changed" } })).not.toBe(
      await recordDigest({ nested: { digest: "kept" } }),
    );
  });
  it("LINT-03: observation-only refresh preserves semantic identity; changed amount does not", async () => {
    const p = await profile();
    const e = await envelope(p, await snapshot(p));
    const refreshed = structuredClone(e);
    refreshed.recordId = "new";
    refreshed.summaryText = "Another display summary";
    refreshed.status = "approved";
    refreshed.intent.expectedState.localReviewExpiresAtUnixSeconds = "2000";
    expect(await semanticIntentDigest(refreshed)).toBe(e.semanticIntentDigest);
    refreshed.intent.parameters.valueNative = "11";
    expect(await semanticIntentDigest(refreshed)).not.toBe(
      e.semanticIntentDigest,
    );
  });
  it("rejects invalid Unicode, non-JSON values, and imprecise numbers", () => {
    expect(() => canonicalJson({ x: "\ud800" })).toThrow();
    expect(() => canonicalJson({ x: 1n })).toThrow();
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
});
