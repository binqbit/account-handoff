import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createSnapshot } from "@account-handoff/contracts";
import type { AccountingLedger } from "@account-handoff/contracts";
import { Application } from "../../../apps/web/src/application/application";
import type { Journal } from "@account-handoff/local-store";
import type { NativeFingerprint } from "@account-handoff/native-adapter";
import {
  account,
  DIGEST,
  evidence,
  HASH,
  M0,
  profile,
} from "../../fixtures/core";

it("produces schema-valid accounting with source-bound actual hold and named-reserve evidence", async () => {
  const app = await Application.create();
  const p = await profile(),
    pure = account(20);
  const fingerprint = {
    genesis: HASH,
    specVersion: 1,
    transactionVersion: 1,
    metadataVersion: 16,
    metadataSha256: DIGEST,
    runtimeCodeHash: HASH,
    anchor: { hash: HASH, number: 100 },
  } as NativeFingerprint;
  const access = app as unknown as {
    metadata: Journal;
    workspace(): unknown;
    chain: unknown;
    connection: unknown;
    accounting(
      f: NativeFingerprint,
      accounts: unknown,
    ): Promise<AccountingLedger>;
  };
  access.workspace = () => ({
    pure,
    M0,
    creationEvidence: [evidence],
    baseline: {
      blockHash: HASH,
      account: {
        proxyDeposit: 10n,
        proxies: [{ delegate: M0.account, proxyType: "Any", delay: 0 }],
      },
    },
  });
  access.chain = { profile: p };
  access.connection = {
    api: {
      consts: { proxy: { proxyDepositBase: 9n, proxyDepositFactor: 1n } },
    },
  };
  try {
    const ledger = await access.accounting(fingerprint, {
      [pure]: {
        free: 100n,
        reserved: 7n,
        frozen: 0n,
        proxyDeposit: 10n,
        holds: [{ id: "AddressMapping", amount: "5" }],
        namedReserves: [{ id: "other", amount: "2" }],
      },
      [M0.account]: { reserved: 10n },
    });
    expect(ledger.status).toBe("reconciled");
    for (const liability of [
      ...ledger.pureReasonHolds,
      ...ledger.pureNamedReserves,
    ]) {
      expect(liability.evidence).toHaveLength(1);
      expect(liability.evidence[0]?.locator).toContain(HASH);
      expect(liability.evidence[0]?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    await expect(
      createSnapshot({
        profile: p,
        anchor: ledger.anchor,
        pure,
        accounting: ledger,
      }),
    ).resolves.toMatchObject({ accounting: { status: "reconciled" } });
    const dual = await access.accounting(fingerprint, {
      [pure]: {
        free: 100n,
        reserved: 8n,
        frozen: 0n,
        proxyDeposit: 11n,
        proxies: [
          { delegate: M0.account, proxyType: "Any", delay: 0 },
          { delegate: account(21), proxyType: "Any", delay: 0 },
        ],
        holds: [{ id: "AddressMapping", amount: "5" }],
        namedReserves: [{ id: "other", amount: "2" }],
      },
      [M0.account]: { reserved: 10n },
    });
    expect(dual.pureProxyIncrementNative).toBe("1");
    expect(dual.adjustmentProvenance).toHaveLength(2);
    await expect(
      createSnapshot({
        profile: p,
        anchor: dual.anchor,
        pure,
        accounting: dual,
      }),
    ).resolves.toMatchObject({ accounting: { status: "reconciled" } });
  } finally {
    access.metadata.close();
  }
});
