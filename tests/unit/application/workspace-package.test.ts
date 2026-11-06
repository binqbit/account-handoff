import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  exportPortable,
  sealRecord,
  semanticIntentDigest,
  type FrozenEnvelope,
} from "@account-handoff/contracts";
import { NativeConnection } from "@account-handoff/native-adapter";
import {
  describeWorkspace,
  exportWorkspacePackage,
  parseWorkspacePackage,
  validateWorkspaceDescriptor,
} from "../../../apps/web/src/application/workspace-package";
import {
  createWorkspaceRecord,
  planHandoff,
} from "../../../apps/web/src/application/workspace-state";
import type { WorkspaceRecord } from "../../../apps/web/src/application/models";
import {
  account,
  HASH,
  profile,
  snapshot,
  envelope,
  signedAttempt,
} from "../../fixtures/core";

function workspace(withPure = false) {
  const result = createWorkspaceRecord(
    {
      name: "Public workspace",
      oldMembers: [account(1), account(2), account(3)],
      threshold: 2,
      funder: account(4),
      reviewers: [account(5), account(6)],
      ...(withPure
        ? {
            beneficiary: account(7),
            contract: `0x${"ab".repeat(20)}`,
            grantId: "0",
          }
        : {}),
    },
    "DEMO",
    HASH as `0x${string}`,
  );
  if (withPure) {
    result.creationEvidence = [
      {
        kind: "native_chain",
        locator: `${HASH}/0`,
        sourceId: HASH,
        contentSha256: "12".repeat(32),
      },
    ];
    result.creationBlock = 10;
  }
  return result;
}
async function evidence() {
  const p = await profile(),
    s = await snapshot(p),
    e = await envelope(p, s),
    a = await signedAttempt(e);
  return { p, s, e, a, records: [p, s, e, a] };
}

describe("public workspace transfer package", () => {
  it("round trips a public setup configuration even before any Pure or grant exists", async () => {
    const w = workspace();
    const p = await profile();
    const exported = await exportWorkspacePackage(w, [p]);
    expect(exported).toMatchObject({
      format: "account-handoff-workspace-package",
      version: 1,
    });
    const imported = await parseWorkspacePackage(canonicalJson(exported));
    expect(imported.source).toBe("workspace-package");
    expect(imported.workspace).toEqual(describeWorkspace(w));
    expect(imported.missingFields).toEqual([]);
    expect(imported.warnings.join(" ")).toContain("unverified");
    expect(imported.workspace.pure).toBeNull();
    expect(imported.workspace.grantId).toBeNull();
  });

  it("preserves grant zero, configured handoff roles and exact creation locators", async () => {
    const w = planHandoff(workspace(true), [
      account(1),
      account(2),
      account(8),
    ]);
    const descriptor = describeWorkspace(w);
    expect(descriptor).toMatchObject({
      grantId: "0",
      creation: { blockHash: HASH, transactionHash: HASH },
      participants: { C: account(3), D: account(8) },
    });
    expect(descriptor.M1?.members).toEqual([
      account(1),
      account(2),
      account(8),
    ]);
    const result = await parseWorkspacePackage(
      canonicalJson(await exportWorkspacePackage(w, [await profile()])),
    );
    expect(result.workspace).toEqual(descriptor);
  });

  it("exports only public configuration and unsigned canonical evidence, without local native history or monetary snapshots", async () => {
    const w = workspace(true);
    Object.assign(w, {
      signedBytes: "PRIVATE_LOCAL_BYTES",
      pending: { approved: true },
      walletPreference: { source: "PRIVATE_WALLET" },
    });
    w.history = [
      { receipt: { signedBytes: "PRIVATE_NATIVE_RECEIPT" } },
    ] as unknown as WorkspaceRecord["history"];
    w.baseline = {
      blockHash: HASH,
      account: { free: 987654321n },
      grant: {},
    } as WorkspaceRecord["baseline"];
    w.handoffBaseline = w.baseline;
    const f = await evidence();
    const exported = await exportWorkspacePackage(w, f.records);
    const json = canonicalJson(exported);
    expect(json).not.toContain("PRIVATE_");
    expect(json).not.toContain("987654321");
    expect(exported.workspace).toMatchObject({
      baselineBlockHash: HASH,
      handoffBaselineBlockHash: HASH,
    });
    expect(exported.workspace.participants).not.toHaveProperty("S");
    const attempt = exported.evidence.records.find(
      (record) => record.kind === "SignedAttempt",
    );
    expect(attempt).toMatchObject({
      recordScope: "portable_export",
      signedExtrinsicBytes: null,
    });
    expect(f.a.signedExtrinsicBytes).toBe("0x0400");
  });

  it("does not expose derived authority, original creator, native receipts or approval flags in the descriptor", () => {
    const descriptor = describeWorkspace(workspace(true));
    expect(Object.keys(descriptor).sort()).toEqual(
      [
        "M0",
        "M1",
        "baselineBlockHash",
        "contract",
        "creation",
        "genesis",
        "grantId",
        "handoffBaselineBlockHash",
        "mode",
        "name",
        "participants",
        "pure",
      ].sort(),
    );
    expect(Object.keys(descriptor.M0).sort()).toEqual(["members", "threshold"]);
  });

  it.each([
    (value: Record<string, unknown>) => {
      value["endpoint"] = "wss://untrusted.invalid/";
    },
    (value: Record<string, unknown>) => {
      value["signedBytes"] = "0x0400";
    },
    (value: Record<string, unknown>) => {
      (value["participants"] as Record<string, unknown>)["S"] = account(9);
    },
    (value: Record<string, unknown>) => {
      (value["M0"] as Record<string, unknown>)["approved"] = true;
    },
    (value: Record<string, unknown>) => {
      value["baseline"] = { balance: "999" };
    },
  ])(
    "rejects nonpublic or execution-bearing descriptor additions %#",
    (mutate) => {
      const value = structuredClone(
        describeWorkspace(workspace()),
      ) as unknown as Record<string, unknown>;
      mutate(value);
      expect(() => validateWorkspaceDescriptor(value)).toThrow(
        "unsupported fields",
      );
    },
  );

  it("rejects duplicate controller members, wrong role sets and unsupported replacement configurations", () => {
    const original = describeWorkspace(workspace());
    expect(() =>
      validateWorkspaceDescriptor({
        ...original,
        M0: { members: [account(1), account(1), account(3)], threshold: 2 },
      }),
    ).toThrow("distinct");
    expect(() =>
      validateWorkspaceDescriptor({
        ...original,
        M0: { members: [account(1), account(2), account(9)], threshold: 2 },
      }),
    ).toThrow("participant roles");
    expect(() =>
      validateWorkspaceDescriptor({
        ...original,
        M1: { members: [account(1), account(2), account(8)], threshold: 2 },
      }),
    ).toThrow("replacement");
    expect(() =>
      validateWorkspaceDescriptor({
        ...original,
        M0: { members: original.M0.members, threshold: 1 },
      }),
    ).toThrow("threshold");
  });

  it("requires an exact locator for a Pure and a contract for any grant ID", () => {
    const original = describeWorkspace(workspace(true));
    expect(() =>
      validateWorkspaceDescriptor({ ...original, creation: null }),
    ).toThrow("creation locator");
    expect(() =>
      validateWorkspaceDescriptor({ ...original, contract: null }),
    ).toThrow("grant ID");
    expect(() =>
      validateWorkspaceDescriptor({ ...original, grantId: "00" }),
    ).toThrow("decimal");
    const missing = workspace(true);
    missing.creationEvidence = [];
    expect(() => describeWorkspace(missing)).toThrow("creation locator");
  });

  it("enforces the exact unsigned grant-ID range and valid Unicode in manually completed descriptors", () => {
    const original = describeWorkspace(workspace(true));
    const maximum = ((1n << 256n) - 1n).toString();
    expect(
      validateWorkspaceDescriptor({ ...original, grantId: maximum }).grantId,
    ).toBe(maximum);
    expect(() =>
      validateWorkspaceDescriptor({
        ...original,
        grantId: (1n << 256n).toString(),
      }),
    ).toThrow("uint256");
    expect(() =>
      validateWorkspaceDescriptor({ ...original, name: "bad\ud800" }),
    ).toThrow("surrogate");
  });

  it("rejects a future container version, unknown outer fields and modified canonical evidence", async () => {
    const pkg = await exportWorkspacePackage(workspace(), [await profile()]);
    await expect(
      parseWorkspacePackage(canonicalJson({ ...pkg, version: 2 })),
    ).rejects.toThrow("version");
    await expect(
      parseWorkspacePackage(
        canonicalJson({ ...pkg, endpoint: "wss://untrusted.invalid/" }),
      ),
    ).rejects.toThrow("unsupported fields");
    pkg.evidence.records[0]!.digest = "00".repeat(32);
    await expect(parseWorkspacePackage(canonicalJson(pkg))).rejects.toThrow();
  });

  it("bounds the complete container and rejects duplicate keys before interpreting content", async () => {
    await expect(
      parseWorkspacePackage(
        `{"format":"account-handoff-workspace-package","for\\u006dat":"other"}`,
      ),
    ).rejects.toThrow("Duplicate");
    await expect(
      parseWorkspacePackage(
        JSON.stringify({ padding: "x".repeat(5 * 1024 * 1024) }),
      ),
    ).rejects.toThrow("byte limit");
  });

  it("previews without connecting a network or activating a workspace", async () => {
    const connect = vi.spyOn(NativeConnection, "connect");
    const result = await parseWorkspacePackage(
      canonicalJson(
        await exportWorkspacePackage(workspace(), [await profile()]),
      ),
    );
    expect(result.source).toBe("workspace-package");
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("legacy evidence-only restoration hints", () => {
  it("does not invent missing workspace configuration from a valid profile-only file", async () => {
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([await profile()])),
    );
    expect(candidate.source).toBe("legacy-evidence");
    expect(candidate.missingFields).toEqual(
      expect.arrayContaining([
        "name",
        "mode",
        "M0",
        "M1",
        "pure",
        "creation",
        "participants.F",
      ]),
    );
    expect(candidate.workspace.M0).toBeUndefined();
    expect(candidate.workspace.pure).toBeUndefined();
  });

  it("extracts unambiguous initial public roles but does not infer mode, label or absent grant state", async () => {
    const f = await evidence();
    const changed: FrozenEnvelope = {
      ...f.e,
      participants: { ...workspace().participants },
    };
    changed.semanticIntentDigest = await semanticIntentDigest(changed);
    const e = await sealRecord(changed);
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([f.p, f.s, e])),
    );
    expect(candidate.workspace.participants).toEqual(
      describeWorkspace(workspace()).participants,
    );
    expect(candidate.workspace.M0?.members).toEqual(workspace().M0.members);
    expect(candidate.workspace.M1).toBeNull();
    expect(candidate.workspace).not.toHaveProperty("mode");
    expect(candidate.workspace).not.toHaveProperty("name");
    expect(candidate.workspace).not.toHaveProperty("pure");
    expect(candidate.workspace).not.toHaveProperty("grantId");
  });

  it("does not choose a current controller from two possible handoff groups", async () => {
    const f = await evidence();
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([f.p, f.s, f.e])),
    );
    expect(candidate.workspace.M0).toBeUndefined();
    expect(candidate.workspace.M1).toBeUndefined();
    expect(candidate.warnings.join(" ")).toContain(
      "Several historical controllers",
    );
    expect(candidate.missingFields).toContain("M0");
  });

  it("keeps conflicting Pure identities explicit instead of selecting the last record", async () => {
    const p = await profile(),
      s = await snapshot(p);
    const first = await sealRecord({
      ...s,
      recordId: "first-pure",
      pure: account(7),
    });
    const second = await sealRecord({
      ...s,
      recordId: "last-pure",
      pure: account(8),
    });
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([p, first, second])),
    );
    expect(candidate.workspace.pure).toBeUndefined();
    expect(candidate.missingFields).toContain("pure");
    expect(candidate.warnings.join(" ")).toContain("Conflicting pure");
  });
});

describe("legacy creation provenance hints", () => {
  async function withCreation(
    p: Awaited<ReturnType<typeof profile>>,
    recordId: string,
    blockHash: string,
  ) {
    const s = await snapshot(p);
    const locator = {
      kind: "native_chain" as const,
      locator: `${blockHash}/1`,
      sourceId: HASH,
      contentSha256: "34".repeat(32),
    };
    return sealRecord({
      ...s,
      recordId,
      pure: account(7),
      accounting: {
        status: "incomplete" as const,
        pure: account(7),
        creator: account(1),
        anchor: s.anchor,
        proxyDepositRecordedNative: "0",
        creatorHistoricalDepositNative: "0",
        creatorCurrentAggregateReservedNative: "0",
        pureProxyIncrementNative: "0",
        pureFreeNative: "0",
        pureReservedNative: "0",
        pureFrozenNative: "0",
        pureReasonHolds: [],
        pureNamedReserves: [],
        pureOtherTracedReservedLiabilitiesNative: "0",
        pureBackedLiabilitiesNative: "0",
        unexplainedReservedDeltaNative: "0",
        constantSetDigest: "34".repeat(32),
        creationProvenance: [locator],
        adjustmentProvenance: [],
        creatorDepositAutomaticallyRefunded: false as const,
        totalBalanceOnHoldAddedAgain: false as const,
      },
    });
  }
  it("recovers a named Pure creation locator even when no standalone creation receipt was exported", async () => {
    const p = await profile();
    const s = await withCreation(p, "named-creation", HASH);
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([p, s])),
    );
    expect(candidate.workspace.creation).toEqual({
      blockHash: HASH,
      transactionHash: HASH,
    });
    expect(candidate.missingFields).not.toContain("creation");
    expect(candidate.workspace.M0).toBeUndefined();
  });
  it("does not choose between conflicting named creation locators", async () => {
    const p = await profile();
    const first = await withCreation(p, "first-creation", HASH);
    const second = await withCreation(
      p,
      "second-creation",
      `0x${"ab".repeat(32)}`,
    );
    const candidate = await parseWorkspacePackage(
      canonicalJson(await exportPortable([p, first, second])),
    );
    expect(candidate.workspace.creation).toBeUndefined();
    expect(candidate.missingFields).toContain("creation");
    expect(candidate.warnings.join(" ")).toContain("Conflicting creation");
  });
});
