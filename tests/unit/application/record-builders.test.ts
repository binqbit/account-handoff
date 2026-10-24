import { describe, expect, it } from "vitest";
import {
  buildReadAnchor,
  buildSigningContext,
  nativeActionFromTree,
} from "../../../apps/web/src/application/record-builders.js";
import { verifyReviewedSigningContext } from "@account-handoff/contracts";
import type { PreparedSigning } from "@account-handoff/native-adapter";
import type { SignerPayloadJSON } from "dedot/types";
import {
  DIGEST,
  HASH,
  envelope,
  profile,
  signingContext,
  snapshot,
  participants,
} from "../../fixtures/core.js";

describe("canonical application integration", () => {
  it("retains and verifies the original numeric wallet payload fields", async () => {
    const p = await profile(),
      e = await envelope(p, await snapshot(p)),
      context = await signingContext(e);
    const prepared: PreparedSigning = {
      payload: JSON.parse(
        context.originalSignPayloadJcsUtf8,
      ) as SignerPayloadJSON,
      rawPayload: "0x010000",
      callHex: "0x0100",
      callHash: HASH as `0x${string}`,
      signer: participants.S as `0x${string}`,
      extra: [],
      encodedExtra: "0x00",
      additionalSigned: "0x",
      createdAt: 100,
      fingerprint: {
        genesis: HASH as `0x${string}`,
        specName: "account-handoff-local",
        specVersion: 1,
        transactionVersion: 1,
        metadataVersion: 16,
        metadataHash: HASH as `0x${string}`,
        metadataSha256: DIGEST,
        rawMetadata: "0x00",
        runtimeCodeHash: HASH as `0x${string}`,
        signedExtensions: [],
        runtimeApis: {},
        anchor: { hash: HASH as `0x${string}`, number: 10 },
        tokenDecimals: 12,
        tokenSymbol: "UNIT",
        ss58Prefix: 42,
      },
    };
    const built = await buildSigningContext(prepared, "test-wallet", "direct");
    expect(JSON.parse(built.originalSignPayloadJcsUtf8).version).toBe(4);
    await expect(verifyReviewedSigningContext(built)).resolves.toBeUndefined();
    expect(
      buildReadAnchor(p, prepared.fingerprint).contextBindings.execution
        .metadataVersion,
    ).toBe("16");
    built.nonce = "1";
    await expect(verifyReviewedSigningContext(built)).rejects.toThrow(/nonce/);
  });
  it("converts an allowed tree and rejects unsupported arbitrary methods", async () => {
    const p = await profile(),
      e = await envelope(p, await snapshot(p));
    expect(nativeActionFromTree(e.callTree)).toEqual({
      kind: "transfer",
      destination: e.intent.parameters.recipient,
      amount: 10n,
    });
    const invalid = structuredClone(e.callTree);
    Object.assign(invalid, {
      palletOrContract: "Utility",
      method: "batch_all",
    });
    expect(() => nativeActionFromTree(invalid)).toThrow();
  });
});
