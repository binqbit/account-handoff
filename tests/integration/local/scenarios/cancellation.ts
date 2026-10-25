import { expect, test } from "@playwright/test";
import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import { NativeConnection } from "@account-handoff/native-adapter";
import { injectLocalWallet } from "../browser-wallet";
import {
  connectAndImport,
  performApproval,
  readFixture,
} from "../browser-support";
import { captureJournalEvidence } from "../journal-evidence";

export function registerCancellationScenarios() {
  test("cancels a pending native proposal through its depositor and refunds the exact reserve", async ({
    page,
  }, testInfo) => {
    const { contents, fixture, binding } = readFixture();
    const connection = await NativeConnection.connect(
      fixture.endpoint,
      "LOCAL",
      binding,
    );
    try {
      const wallet = await injectLocalWallet(
        page,
        connection,
        "http://127.0.0.1:4175",
      );
      await connectAndImport(page, contents, fixture.endpoint);
      const before = await connection.readAccount(wallet.accounts.A);
      const pureBefore = await connection.readAccount(
        fixture.input.beneficiary,
      );
      const controller = pureBefore.proxies[0]!.delegate;
      const replacement = u8aToHex(createKeyMulti(fixture.input.newMembers, 2));
      const inner = connection.transaction({
        kind: "proxy",
        beneficiary: fixture.input.beneficiary,
        inner: { kind: "add-proxy", delegate: replacement },
      });
      const callHash = blake2AsHex(inner.callHex);
      await performApproval(
        page,
        "A",
        wallet.accounts.A,
        "GRC-ROTATION-ADD-M1",
      );
      const proposal = await connection.proposal(controller, callHash);
      expect(proposal).not.toBeNull();
      expect(proposal!.depositor).toBe(wallet.accounts.A);
      const reserved = await connection.readAccount(wallet.accounts.A);
      expect(reserved.reserved - before.reserved).toBe(proposal!.deposit);
      expect(
        (await connection.readAccount(fixture.input.beneficiary)).proxies,
      ).toEqual(pureBefore.proxies);
      await performApproval(
        page,
        "A",
        wallet.accounts.A,
        "GRC-MULTISIG-CANCEL",
        {
          "Proposal controller": "M0",
          "Exact native call hash": callHash,
        },
      );
      expect(await connection.proposal(controller, callHash)).toBeNull();
      const after = await connection.readAccount(wallet.accounts.A);
      expect(after.reserved).toBe(before.reserved);
      expect(
        (await connection.readAccount(fixture.input.beneficiary)).proxies,
      ).toEqual(pureBefore.proxies);
      expect(wallet.requests.map((request) => request.role)).toEqual([
        "A",
        "A",
      ]);
      await captureJournalEvidence(page, testInfo, connection, 2);
      await testInfo.attach("proposal-reserve-refund", {
        body: JSON.stringify(
          { callHash, deposit: proposal!.deposit, before, reserved, after },
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      await connection.close();
    }
  });
}
