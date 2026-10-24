import { describe, it, expect } from "vitest";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { u8aToHex } from "dedot/utils";
import type { SignerPayloadJSON } from "dedot/types";
import {
  requestSignature,
  verifyNativeSignature,
  WalletRejectedError,
  WalletGuardError,
  type WalletSession,
} from "@account-handoff/wallet-adapter";

const payload = {
  address: "",
  blockHash: `0x${"11".repeat(32)}`,
  blockNumber: "0x01",
  era: "0x00",
  genesisHash: `0x${"11".repeat(32)}`,
  method: "0x1234",
  nonce: "0x00",
  signedExtensions: [],
  specVersion: "0x01",
  tip: "0x00",
  transactionVersion: "0x01",
  version: 4,
  withSignedTransaction: false,
} as SignerPayloadJSON;
describe("signature-only native wallet boundary", () => {
  it("accepts only the exact native signing bytes and actual signer", async () => {
    await cryptoWaitReady();
    const pair = new Keyring({ type: "sr25519" }).addFromUri("//Alice");
    const raw = "0x1234";
    const signature = u8aToHex(
      pair.sign(Uint8Array.from([0x12, 0x34]), { withType: true }),
    );
    expect(
      await verifyNativeSignature(raw, signature, pair.address, "sr25519"),
    ).toBe(true);
    expect(
      await verifyNativeSignature("0x1235", signature, pair.address, "sr25519"),
    ).toBe(false);
    expect(
      await verifyNativeSignature(raw, signature, pair.address, "ed25519"),
    ).toBe(false);
  });
  it("rejects a wallet-supplied replacement transaction even with a signature field", async () => {
    await cryptoWaitReady();
    const pair = new Keyring({ type: "sr25519" }).addFromUri("//Alice");
    const session: WalletSession = {
      source: "test",
      version: "1",
      accounts: [],
      subscribe: async () => () => {},
      signPayload: async () => ({
        signature: "0x01",
        signedTransaction: "0xdead",
      }),
    };
    await expect(
      requestSignature(
        session,
        { address: pair.address, source: "test" },
        { ...payload, address: pair.address },
        "0x1234",
      ),
    ).rejects.toBeInstanceOf(WalletGuardError);
  });
  it("keeps explicit user rejection distinct from uncertain transport failure", async () => {
    await cryptoWaitReady();
    const pair = new Keyring({ type: "sr25519" }).addFromUri("//Alice");
    const session: WalletSession = {
      source: "test",
      version: "1",
      accounts: [],
      subscribe: async () => () => {},
      signPayload: async () => {
        throw Object.assign(new Error("Rejected"), { code: 4001 });
      },
    };
    await expect(
      requestSignature(
        session,
        { address: pair.address, source: "test" },
        { ...payload, address: pair.address },
        "0x1234",
      ),
    ).rejects.toBeInstanceOf(WalletRejectedError);
    session.signPayload = async () => {
      throw new Error("Transport disconnected");
    };
    await expect(
      requestSignature(
        session,
        { address: pair.address, source: "test" },
        { ...payload, address: pair.address },
        "0x1234",
      ),
    ).rejects.toThrow("Transport disconnected");
  });
});
