import { describe, expect, it } from "vitest";
import { sealRecord, validateRecord, validateRecordSemantics } from "@account-handoff/contracts";
import { DIGEST, HASH, evidence, profile } from "../../fixtures/core";

describe("qualified automatic mapping", () => {
  it("round-trips automatic mapping while refusing contradictory mapping requirements", async () => {
    const p = await profile();
    p.mappingPolicy = { ...p.mappingPolicy, autoMap: true, explicitMappingRequired: false };
    const sealed = await sealRecord(p);
    expect(validateRecord(sealed).ok).toBe(true);
    expect(await validateRecordSemantics(sealed)).toEqual([]);
    for (const [autoMap, explicitMappingRequired] of [[true, true], [false, false]])
      expect(validateRecord({ ...sealed, mappingPolicy: { ...sealed.mappingPolicy, autoMap, explicitMappingRequired } }).ok).toBe(false);
  });

  it("requires explicit deployed-runtime evidence for PortalDot instead of inventing source provenance", async () => {
    const p = await profile();
    const remote = { ...p, status: "accepted", genesis: HASH, runtimeCodeHash: HASH,
      metadataSha256: DIGEST, specVersion: "3002", transactionVersion: "1",
      specName: "portaldot-v3", metadataVersion: "16",
      bindingEvidence: { ...p.bindingEvidence, rawMetadataEvidence: evidence,
        rawRuntimeCodeEvidence: evidence, runtimeArtifactVerification: evidence } };
    expect(validateRecord(remote).ok).toBe(true);
    expect(validateRecord({ ...remote, bindingEvidence: { ...remote.bindingEvidence, runtimeArtifactVerification: null } }).ok).toBe(false);
    expect(validateRecord({ ...remote, specName: "unknown-network" }).ok).toBe(false);
    expect(remote.bindingEvidence.runtimeSourceBuildRelationship).toBeNull();
  });
});
