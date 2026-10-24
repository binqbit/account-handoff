import { describe, expect, it } from "vitest";
import type { SignerPayloadJSON } from "dedot/types";
import { canonicalJson } from "@account-handoff/contracts";
import { normalizeSignerPayload } from "@account-handoff/native-adapter";

describe("native wallet JSON payload boundary", () => {
  it("omits library undefined optionals before both recording and wallet transport, preserving numeric types", () => {
    const libraryPayload = {
      address: `0x${"11".repeat(32)}`,
      blockHash: `0x${"22".repeat(32)}`,
      blockNumber: "0x64",
      genesisHash: `0x${"33".repeat(32)}`,
      method: "0x0100",
      era: "0x4500",
      nonce: "0x00",
      specVersion: "0x110",
      transactionVersion: "0x02",
      signedExtensions: ["CheckMetadataHash"],
      tip: "0x00",
      version: 4,
      mode: 0,
      withSignedTransaction: false,
      metadataHash: undefined,
      assetId: undefined,
    } as unknown as SignerPayloadJSON;
    const request = normalizeSignerPayload(libraryPayload);
    expect(request).not.toHaveProperty("metadataHash");
    expect(request).not.toHaveProperty("assetId");
    expect(request.version).toBe(4);
    expect(request.mode).toBe(0);
    expect(request.withSignedTransaction).toBe(false);
    expect(JSON.parse(canonicalJson(request))).toEqual(
      JSON.parse(JSON.stringify(libraryPayload)),
    );
    expect(request).not.toBe(libraryPayload);
  });
});
