import { describe, expect, it } from "vitest";
import {
  buildReadAnchor,
  buildSigningContext,
  nativeActionFromTree,
  buildReceipt,
  cancellationMatches,
} from "../../../apps/web/src/application/record-builders.js";
import {
  verifyReviewedSigningContext,
  createFrozenEnvelope,
  createSignedAttempt,
} from "@account-handoff/contracts";
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
  M0,
  anchor,
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
  it("requires exact cancellation event and target-state evidence instead of bare outer success", async () => {
    const p = await profile(),
      s = await snapshot(p),
      base = await envelope(p, s);
    const when = {
      height: "5",
      index: "1",
      clockDomain: "native-block-number",
    };
    const intent = {
      ...base.intent,
      operationId: "GRC-MULTISIG-CANCEL" as const,
      parameters: {
        targetController: M0,
        targetCallHash: HASH,
        targetTimepoint: when,
        originalDepositor: participants.S,
        targetEnvelopeDigest: null,
        originalTargetCallBytes: null,
      },
    };
    const e = await createFrozenEnvelope({
      intent,
      anchor: s.anchor,
      plan: {
        callTree: {
          kind: "native_call",
          palletOrContract: "Multisig",
          method: "cancel_as_multi",
          parameters: {
            threshold: "2",
            otherSignatories: M0.members.slice(0, 2),
            timepoint: when,
            callHash: HASH,
          },
          children: [],
          sourceEvidence: base.evidence,
        },
        signingPath: "direct",
        controller: null,
        requiredSigners: [participants.S],
      },
      innerRuntimeCallBytes: "0x0100",
      innerRuntimeCallHash: null,
      resources: { ...base.resources, valueNative: "0" },
      summaryText: "Cancel one proposal",
      requiredGateIds: ["Q-RUNTIME"],
      participants: base.participants,
      evidence: base.evidence,
    });
    const context = await signingContext(e);
    context.operationPhase = "cancel";
    const a = await createSignedAttempt({
      envelope: e,
      context,
      bytes: "0x0400",
      hash: HASH,
    });
    const native = {
      txHash: HASH as `0x${string}`,
      blockHash: HASH as `0x${string}`,
      blockNumber: 10,
      txIndex: 2,
      outerSuccess: true,
      nestedSuccess: true,
      businessExecuted: true,
      failure: null,
      events: [
        { pallet: "System", name: "ExtrinsicSuccess", data: {}, index: 1 },
      ],
    };
    expect(
      (await buildReceipt(e, a, native, anchor(), "cancel")).businessEffect,
    ).toBe("context_mismatch");
    native.events.unshift({
      pallet: "Multisig",
      name: "MultisigCancelled",
      data: {
        cancelling: participants.S,
        multisig: M0.account,
        callHash: HASH,
        timepoint: { height: 5, index: 1 },
      },
      index: 0,
    });
    expect(cancellationMatches(e, native)).toBe(true);
    expect(
      (await buildReceipt(e, a, native, anchor(), "cancel")).businessEffect,
    ).toBe("unknown");
    const result = await buildReceipt(e, a, native, anchor(), "cancel", {
      targetProposalAfter: "cancelled",
    });
    expect(result.businessEffect).toBe("historically_verified");
    expect(result.targetProposalAfter).toBe("cancelled");
    expect(result.proposalAfter).toBeNull();
    native.events[0]!.data = {
      cancelling: participants.A,
      multisig: M0.account,
      callHash: HASH,
      timepoint: { height: 5, index: 1 },
    };
    expect(cancellationMatches(e, native)).toBe(false);
  });
});
