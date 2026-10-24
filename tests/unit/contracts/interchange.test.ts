import { describe, expect, it } from "vitest";
import {
  exportPortable,
  importPortable,
  parseBoundedJson,
  validatePortablePackage,
} from "@account-handoff/contracts";
import {
  envelope,
  profile,
  signedAttempt,
  snapshot,
} from "../../fixtures/core.js";

describe("bounded untrusted interchange", () => {
  it("SG-01: detects escaped duplicate keys before object conversion", () => {
    expect(() => parseBoundedJson('{"account":1,"acc\\u006funt":2}')).toThrow(
      /Duplicate/,
    );
    expect(() => parseBoundedJson('{"__proto__":{}}')).toThrow();
    expect(() => parseBoundedJson('{"x":"\\ud800"}')).toThrow();
    expect(() => parseBoundedJson(new Uint8Array([0xff]))).toThrow();
  });
  it("enforces byte, depth and ordinary-array limits at their boundaries", () => {
    expect(parseBoundedJson('"é"', { maxBytes: 4 })).toBe("é");
    expect(() => parseBoundedJson('"é"', { maxBytes: 3 })).toThrow();
    expect(parseBoundedJson("[1,2]", { maxArrayItems: 2 })).toEqual([1, 2]);
    expect(() => parseBoundedJson("[1,2,3]", { maxArrayItems: 2 })).toThrow();
    expect(() => parseBoundedJson("[[[0]]]", { maxDepth: 2 })).toThrow();
  });
  it("SG-25: signed packet export creates new identity and preserves graph closure", async () => {
    const p = await profile(),
      s = await snapshot(p),
      e = await envelope(p, s),
      a = await signedAttempt(e);
    const pkg = await exportPortable([p, s, e, a]);
    expect(validatePortablePackage(pkg).ok).toBe(true);
    const exported = pkg.records.find(
      (record) => record.kind === "SignedAttempt",
    );
    expect(exported?.kind).toBe("SignedAttempt");
    if (exported?.kind !== "SignedAttempt") throw new Error("missing attempt");
    expect(exported.signedExtrinsicBytes).toBeNull();
    expect(exported.recordScope).toBe("portable_export");
    expect(exported.recordId).not.toBe(a.recordId);
    expect(exported.digest).not.toBe(a.digest);
    expect(exported.derivedFromRecordDigest).toBe(a.digest);
    expect(
      (await importPortable(JSON.stringify(pkg))).needsReconciliation,
    ).toBe(true);
    expect(a.signedExtrinsicBytes).toBe("0x0400");
  });
  it("rejects tampered digests and missing dependencies", async () => {
    const p = await profile(),
      s = await snapshot(p),
      e = await envelope(p, s);
    await expect(exportPortable([e])).rejects.toThrow(/requires/);
    const pkg = await exportPortable([p, s, e]);
    pkg.records[0]!.digest = "00".repeat(32);
    await expect(importPortable(JSON.stringify(pkg))).rejects.toThrow();
  });
});
