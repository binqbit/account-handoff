import { describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceCertificate,
  inspectM1ProofRoute,
} from "../../../apps/web/src/application/continuity.js";
import type { WorkspaceCertificateInput } from "../../../apps/web/src/application/continuity.js";
import {
  account,
  envelope,
  M0,
  M1,
  participants,
  profile,
  snapshot,
} from "../../fixtures/core.js";

import type { WorkspaceRecord } from "../../../apps/web/src/application/models.js";

describe("workspace continuity certificate admission", () => {
  it("does not infer continuity or make network calls when either real operation receipt is missing", async () => {
    const readAccount = vi.fn();
    const receiptAt = vi.fn();
    const inspectExtrinsic = vi.fn();
    const input = {
      connection: { readAccount, receiptAt, inspectExtrinsic },
      workspace: {},
      profile: await profile(),
      records: [],
    } as unknown as WorkspaceCertificateInput;
    expect(await buildWorkspaceCertificate(input)).toBeNull();
    expect(readAccount).not.toHaveBeenCalled();
    expect(receiptAt).not.toHaveBeenCalled();
    expect(inspectExtrinsic).not.toHaveBeenCalled();
  });
  it("does not promote an imported or unqualified profile merely because records claim success", async () => {
    const input = {
      connection: {},
      workspace: {},
      profile: await profile(),
      records: [
        { kind: "ReceiptBundle", operationId: "GRC-ROTATION-REMOVE-M0" },
        { kind: "ReceiptBundle", operationId: "GRC-GRANT-SUBMIT-M1" },
      ],
    } as unknown as WorkspaceCertificateInput;
    expect(await buildWorkspaceCertificate(input)).toBeNull();
  });
  it("checks exact decoded MultiAddress.Id routing for a real M1 removal proof", async () => {
    const p = await profile();
    const e = await envelope(p, await snapshot(p));
    e.intent.operationId = "GRC-ROTATION-REMOVE-M0";
    const pure = account(20);
    const w = { M0, M1, pure, participants } as WorkspaceRecord;
    const leaf = {
      pallet: "Proxy",
      palletCall: {
        name: "RemoveProxy",
        params: {
          delegate: { type: "Id", value: M0.account },
          proxyType: "Any",
          delay: 0,
        },
      },
    };
    const call = {
      pallet: "Multisig",
      palletCall: {
        name: "AsMulti",
        params: {
          threshold: 2,
          otherSignatories: [participants.A, participants.B],
          call: {
            pallet: "Proxy",
            palletCall: {
              name: "Proxy",
              params: {
                real: { type: "Id", value: pure },
                forceProxyType: "Any",
                call: leaf,
              },
            },
          },
        },
      },
    };
    const inspected = {
      bytes: "0x00" as const,
      callHex: "0x00" as const,
      signer: participants.D,
      call,
    };
    expect(() => inspectM1ProofRoute(inspected, e, w, false)).not.toThrow();
    leaf.palletCall.params.delegate.value = participants.A;
    expect(() => inspectM1ProofRoute(inspected, e, w, false)).toThrow(
      /exact old-controller/,
    );
  });
});
