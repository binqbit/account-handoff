import { describe, expect, it } from "vitest";
import { $Metadata, Metadata } from "dedot/codecs";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import { sealRecord, sha256 } from "@account-handoff/contracts";
import type { GateId, GateRecord } from "@account-handoff/contracts";
import type { NativeFingerprint } from "@account-handoff/native-adapter";
import type { FreshOperationInput } from "@account-handoff/domain";
import {
  assessCurrentWallet,
  buildLocalQualification,
  completePreparationSnapshot,
} from "../../../apps/web/src/application/qualification";
import type { LocalDescriptor } from "../../../apps/web/src/application/models";
import {
  DIGEST,
  HASH,
  envelope,
  evidence,
  participants,
  profile,
  signingContext,
  snapshot,
} from "../../fixtures/core";

async function localFixture(): Promise<{
  descriptor: LocalDescriptor;
  fingerprint: NativeFingerprint;
}> {
  // Minimal codec-valid metadata for this boundary test; it is never used as a runtime fixture.
  const metadata = new Metadata(0x6174656d, {
    type: "V15",
    value: {
      types: [
        {
          id: 0,
          path: [],
          params: [],
          typeDef: { type: "Primitive", value: { kind: "u8" } },
          docs: [],
        },
      ],
      pallets: [],
      extrinsic: {
        version: 4,
        addressTypeId: 0,
        callTypeId: 0,
        signatureTypeId: 0,
        extraTypeId: 0,
        signedExtensions: [],
      },
      runtimeType: 0,
      apis: [
        {
          name: "ReviveApi",
          methods: [
            {
              name: "call",
              inputs: [{ name: "origin", typeId: 0 }],
              output: 0,
              docs: [],
            },
          ],
          docs: [],
        },
      ],
      outerEnums: { callEnumTypeId: 0, eventEnumTypeId: 0, errorEnumTypeId: 0 },
      custom: { map: new Map() },
    },
  });
  const bytes = $Metadata.tryEncode(metadata);
  const fingerprint: NativeFingerprint = {
    genesis: HASH as `0x${string}`,
    specName: "account-handoff-local",
    specVersion: 1,
    transactionVersion: 1,
    metadataVersion: 15,
    metadataHash: blake2AsHex(bytes),
    metadataSha256: await sha256(bytes),
    rawMetadata: u8aToHex(bytes),
    runtimeCodeHash: HASH as `0x${string}`,
    signedExtensions: [],
    runtimeApis: {
      [blake2AsHex(new TextEncoder().encode("ReviveApi"), 64)]: 2,
    },
    anchor: { hash: HASH as `0x${string}`, number: 10 },
    metadataBinding: "pinned-runtime-code",
    metadataSourceAnchor: { blockHash: HASH as `0x${string}`, blockNumber: 1 },
    tokenDecimals: 14,
    tokenSymbol: "UNIT",
    ss58Prefix: 42,
  };
  const descriptor: LocalDescriptor = {
    mode: "LOCAL",
    runId: "synthetic",
    generation: 1,
    status: "running",
    nativeRpc: "ws://127.0.0.1:9944",
    gatewayRpc: "http://127.0.0.1:8545",
    namespace: "synthetic",
    buildHash: DIGEST,
    sourceCommit: "a".repeat(40),
    qualified: true,
    genesisHash: HASH,
    runtimeCodeHash: HASH,
    metadataSha256: fingerprint.metadataSha256,
    nativeMetadataBinding: {
      genesis: fingerprint.genesis,
      specVersion: fingerprint.specVersion,
      runtimeCodeHash: fingerprint.runtimeCodeHash,
      metadataSha256: fingerprint.metadataSha256,
      rawMetadata: fingerprint.rawMetadata,
      sourceAnchor: fingerprint.metadataSourceAnchor!,
    },
    generatedNativeTypesSha256: DIGEST,
    runtime: {
      specName: "account-handoff-local",
      specVersion: 1,
      nativeDecimals: 14,
      nativeToEthRatio: "10000",
      autoMap: false,
    },
  };
  return { descriptor, fingerprint };
}

describe("operation-specific LOCAL qualification", () => {
  it("rechecks the current wallet account type and A/D availability independently of prior snapshots", async () => {
    const original = await profile();
    const p = {
      ...original,
      genesis: HASH,
      metadataSha256: DIGEST,
      runtimeCodeHash: HASH,
    };
    const e = await envelope(p, await snapshot(p));
    e.intent.operationId = "GRC-ROTATION-REMOVE-M0";
    const context = await signingContext(e);
    context.walletBuildId = "test-wallet:1";
    context.signer = participants.A;
    context.operationPhase = "multisig_first";
    const input = {
      profile: p,
      envelope: e,
      signer: participants.A,
      phase: "multisig_first" as const,
      signingContext: context,
      wallet: {
        source: "test-wallet",
        version: "1",
        accounts: [participants.A, participants.D].map((address) => ({
          address,
          type: "sr25519",
          source: "test-wallet",
        })),
      },
    };
    expect(assessCurrentWallet(input).blockers).toEqual([]);
    input.wallet.accounts.pop();
    expect(
      assessCurrentWallet(input).blockers.map((blocker) => blocker.code),
    ).toEqual(["ReadinessChanged"]);
    input.wallet.accounts[0]!.type = "ethereum";
    expect(
      assessCurrentWallet(input).blockers.map((blocker) => blocker.code),
    ).toContain("WalletChanged");
  });
  it("does not promote runtime identity into unobserved currency, API, vesting or receipt capability", async () => {
    const result = await buildLocalQualification(await localFixture());
    expect(result.status).toBe("accepted");
    expect(
      result.gateRecords
        .filter((item) => item.status === "accepted")
        .map((item) => item.id),
    ).toEqual(["Q-RUNTIME"]);
    expect(result.apiBindings).toEqual([]);
  });
  it("keeps immutable profile qualification content stable across finalized heads", async () => {
    const input = await localFixture();
    const first = await buildLocalQualification(input);
    input.fingerprint.anchor = { hash: `0x${"ab".repeat(32)}`, number: 500 };
    expect(await buildLocalQualification(input)).toEqual(first);
  });
  it("requires the exact verified decoder binding instead of accepting an unbound client", async () => {
    const input = await localFixture();
    input.fingerprint.metadataBinding = "unbound-client-cache";
    expect((await buildLocalQualification(input)).status).toBe("candidate");
    input.fingerprint.metadataBinding = "pinned-runtime-code";
    input.descriptor.nativeMetadataBinding!.rawMetadata = "0x00";
    expect((await buildLocalQualification(input)).status).toBe("candidate");
  });
  it("derives API method codec IDs from exact metadata and refuses another advertised API version", async () => {
    const { descriptor, fingerprint } = await localFixture();
    const source = { ...evidence, sourceId: descriptor.sourceCommit! };
    descriptor.capabilities = {
      format: "account-handoff-local-capabilities-v1",
      runId: descriptor.runId,
      generation: descriptor.generation,
      genesisHash: HASH,
      runtimeCodeHash: HASH,
      metadataSha256: fingerprint.metadataSha256,
      generatedNativeTypesSha256: DIGEST,
      apiSource: { trait: [source], implementation: [source] },
    };
    const result = await buildLocalQualification({ descriptor, fingerprint });
    expect(result.apiBindings[0]?.methods[0]?.canonicalSignature).toBe(
      `ReviveApi.call(origin:scaleType(0))->scaleType(0)@${fingerprint.metadataSha256}`,
    );
    expect(result.apiBindings[0]?.methods[0]?.inputCodecArtifactSha256).toBe(
      DIGEST,
    );
    expect(
      result.gateRecords.find((item) => item.id === "Q-REVIVE-API")?.status,
    ).toBe("accepted");
    fingerprint.runtimeApis[
      blake2AsHex(new TextEncoder().encode("ReviveApi"), 64)
    ] = 3;
    expect(
      (await buildLocalQualification({ descriptor, fingerprint })).apiBindings,
    ).toEqual([]);
    fingerprint.rawMetadata = "0x00";
    expect(
      (await buildLocalQualification({ descriptor, fingerprint })).status,
    ).toBe("candidate");
  });
  it("rejects capability evidence from a previous LOCAL generation", async () => {
    const { descriptor, fingerprint } = await localFixture();
    descriptor.capabilities = {
      format: "account-handoff-local-capabilities-v1",
      runId: descriptor.runId,
      generation: 0,
      genesisHash: HASH,
      runtimeCodeHash: HASH,
      metadataSha256: fingerprint.metadataSha256,
      generatedNativeTypesSha256: DIGEST,
      currency: {
        composition: "shared-balances-with-reason-holds",
        nativeToEthRatio: "10000",
        nativeDecimals: 14,
        evidence: [{ ...evidence, sourceId: descriptor.sourceCommit! }],
      },
    };
    expect(
      (
        await buildLocalQualification({ descriptor, fingerprint })
      ).gateRecords.find((item) => item.id === "Q-CURRENCY")?.status,
    ).toBe("not_qualified");
  });
  it("does not relabel old native probe evidence with a new manifest generation", async () => {
    const { descriptor, fingerprint } = await localFixture();
    descriptor.capabilities = {
      format: "account-handoff-local-capabilities-v1",
      runId: descriptor.runId,
      generation: descriptor.generation,
      genesisHash: HASH,
      runtimeCodeHash: HASH,
      metadataSha256: fingerprint.metadataSha256,
      generatedNativeTypesSha256: DIGEST,
      receipts: {
        correlation: "finalized-block-extrinsic-index-and-whole-byte-hash",
        nestedFailures: "proxy-and-multisig-inspected",
        successEvidence: [
          {
            ...evidence,
            kind: "native_chain",
            sourceId: `${HASH}:${descriptor.runId}:0`,
          },
        ],
        failureEvidence: [
          {
            ...evidence,
            kind: "native_chain",
            sourceId: `${HASH}:${descriptor.runId}:0`,
          },
        ],
      },
    };
    const result = await buildLocalQualification({ descriptor, fingerprint });
    expect(
      result.gateRecords.find((item) => item.id === "Q-RECEIPTS")?.status,
    ).toBe("not_qualified");
  });
  it("completes only satisfied action gates and refuses a signer budget or missing capability", async () => {
    const original = await profile();
    const capability = (id: GateId): GateRecord => ({
      id,
      status: "accepted",
      stage: "profile_capability",
      subject: "synthetic test only",
      evidence: [evidence],
      anchor: null,
      reason: "Synthetic qualified input boundary",
    });
    const p = await sealRecord({
      ...original,
      status: "accepted" as const,
      genesis: HASH,
      runtimeCodeHash: HASH,
      metadataSha256: DIGEST,
      gateRecords: ["Q-RUNTIME", "Q-CURRENCY", "Q-ADAPTER", "Q-RECEIPTS"].map(
        (id) => capability(id as GateId),
      ),
    });
    const s = await snapshot(p),
      e = await envelope(p, s),
      context = await signingContext(e);
    context.walletBuildId = "test-wallet:1";
    const fresh: FreshOperationInput = {
      envelope: e,
      signer: participants.S,
      phase: "direct",
      profileDigest: p.digest,
      timeUnixSeconds: 100n,
      authorityTuples: null,
      accounts: {
        [participants.S]: {
          free: 100n,
          frozen: 0n,
          reserved: 0n,
          mappedTo: null,
        },
      },
      grant: null,
      grantScope: "Unverified",
      grantHistoryComplete: false,
      proposal: null,
      pure: null,
      mappedPure: null,
      M0: "old",
      M1: "new",
      existentialDepositNative: 1n,
    };
    const input = {
      profile: p,
      snapshot: s,
      envelope: e,
      freshInput: fresh,
      signingContext: context,
      wallet: {
        source: "test-wallet",
        version: "1",
        accounts: [
          { address: participants.S, type: "sr25519", source: "test-wallet" },
        ],
      },
    };
    const result = await completePreparationSnapshot(input);
    expect(result.blockers).toEqual([]);
    expect(result.snapshot.completeness).toBe("complete");
    fresh.accounts[participants.S]!.free = 5n;
    expect(
      (await completePreparationSnapshot(input)).blockers.some(
        (item) => item.code === "InsufficientLiquidity",
      ),
    ).toBe(true);
    fresh.accounts[participants.S]!.free = 100n;
    p.gateRecords = p.gateRecords.filter((item) => item.id !== "Q-RECEIPTS");
    const incomplete = await completePreparationSnapshot(input);
    expect(incomplete.snapshot.completeness).toBe("incomplete");
    expect(
      incomplete.blockers.some((item) => item.message.includes("Q-RECEIPTS")),
    ).toBe(true);
    p.gateRecords.push(capability("Q-WALLET"));
    input.wallet.version = "unknown";
    const changedWallet = await completePreparationSnapshot(input);
    expect(
      changedWallet.blockers.some(
        (item) =>
          item.code === "MissingActionInput" &&
          item.message.startsWith("Q-WALLET"),
      ),
    ).toBe(true);
  });
});
