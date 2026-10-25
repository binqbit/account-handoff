import { beforeEach, describe, expect, it, vi } from "vitest";
import { blake2AsHex } from "dedot/utils";
import type {
  NativeConnection,
  NativeFingerprint,
} from "@account-handoff/native-adapter";
import { readTestnetDescriptor } from "../../../apps/web/src/application/testnet-descriptor";
import { buildTestnetQualification } from "../../../apps/web/src/application/qualification/testnet";
import {
  createChainProfile,
  validateRecordSemantics,
} from "@account-handoff/contracts";

vi.mock("../../../apps/web/src/application/local-import", () => ({
  verifyContractAt: vi.fn(async () => {}),
}));

async function fixture() {
  const descriptor = await readTestnetDescriptor();
  descriptor.verification = {
    runtimeCodeHash: descriptor.nativeMetadataBinding.runtimeCodeHash,
    packageLockSha256: "34".repeat(32),
    metadataSha256: descriptor.metadataSha256,
    evidence: {
      kind: "local_artifact",
      locator: "synthetic:fork-test",
      sourceId: descriptor.runtimeCodeHash,
      contentSha256: "12".repeat(32),
    },
    capabilities: [
      "currency",
      "automatic-mapping",
      "vesting",
      "native-codec",
      "signing",
      "receipts",
      "proxy-multisig",
      "revive-api",
    ],
  };
  const fingerprint: NativeFingerprint = {
    ...descriptor.nativeMetadataBinding,
    metadataBinding: "pinned-runtime-code",
    metadataSourceAnchor: descriptor.nativeMetadataBinding.sourceAnchor,
    metadataHash: blake2AsHex(descriptor.nativeMetadataBinding.rawMetadata),
    specName: "portaldot-v3",
    transactionVersion: 1,
    metadataVersion: 16,
    signedExtensions: [],
    runtimeApis: {
      [blake2AsHex(new TextEncoder().encode("ReviveApi"), 64)]: 2,
    },
    anchor: {
      hash: descriptor.nativeMetadataBinding.sourceAnchor.blockHash,
      number: 1,
    },
    tokenDecimals: 14,
    tokenSymbol: "tPOT",
    ss58Prefix: 42,
  };
  const connection = {
    api: {
      consts: {
        revive: { nativeToEthRatio: 10000, autoMap: true },
        balances: { existentialDeposit: 10n ** 13n },
        vesting: { minVestedTransfer: 10n ** 15n },
      },
    },
  } as unknown as NativeConnection;
  return { descriptor, fingerprint, connection };
}

beforeEach(() => vi.clearAllMocks());
describe("PortalDot qualification", () => {
  it("accepts the bound automatic runtime without requiring a LOCAL descriptor or claiming its source build", async () => {
    const { descriptor, fingerprint, connection } = await fixture();
    const result = await buildTestnetQualification(
      descriptor,
      fingerprint,
      connection,
    );
    expect(result.status).toBe("accepted");
    expect(result.gateRecords).toHaveLength(8);
    expect(result.gateRecords.every((g) => g.status === "accepted")).toBe(true);
    expect(result.bindingEvidence.runtimeSourceBuildRelationship).toBeNull();
    const profile = await createChainProfile({
      profileId: "synthetic-testnet-profile",
      ...result,
      fingerprint: {
        ...fingerprint,
        specVersion: String(fingerprint.specVersion),
        transactionVersion: "1",
        metadataVersion: "16",
      },
    });
    expect(await validateRecordSemantics(profile)).toEqual([]);
    expect(profile.mappingPolicy).toMatchObject({
      autoMap: true,
      explicitMappingRequired: false,
    });
  });
  it("does not promote a metadata match or unbound fork evidence into verified capabilities", async () => {
    const { descriptor, fingerprint, connection } = await fixture();
    descriptor.verification = null;
    expect(
      (await buildTestnetQualification(descriptor, fingerprint, connection))
        .status,
    ).toBe("candidate");
  });
  it("rejects a changed runtime, API version and automatic-mapping constant", async () => {
    const { descriptor, fingerprint, connection } = await fixture();
    for (const f of [
      { ...fingerprint, runtimeCodeHash: `0x${"11".repeat(32)}` as const },
      { ...fingerprint, runtimeApis: {} },
    ])
      expect(
        (await buildTestnetQualification(descriptor, f, connection)).status,
      ).toBe("candidate");
    Object.assign(connection.api.consts.revive, { autoMap: false });
    expect(
      (await buildTestnetQualification(descriptor, fingerprint, connection))
        .status,
    ).toBe("candidate");
  });
});
