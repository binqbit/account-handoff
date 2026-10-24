/** A test-only native wallet bridge. Secret derivation and signing stay in Node. */
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ExtraSignedExtension } from "dedot";
import type { SignerPayloadJSON } from "dedot/types";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import type { Page } from "@playwright/test";
import {
  account,
  hex,
  signatureBytes,
  type NativeConnection,
} from "@account-handoff/native-adapter";

export type LocalRole =
  "A" | "B" | "C" | "D" | "F" | "R1" | "R2" | "S" | "F2" | "R1_2" | "R2_2";
export interface WalletRequestLog {
  role: LocalRole;
  address: string;
  callHash: string;
  nonce: string;
  sequence: number;
}
const walletTraces = new WeakMap<
  Page,
  { requests: WalletRequestLog[]; rejected: LocalRole[] }
>();
export function localWalletTrace(page: Page) {
  return walletTraces.get(page);
}
const roleUris: Record<LocalRole, string> = {
  A: "//Alice",
  B: "//Bob",
  C: "//Charlie",
  D: "//Dave",
  F: "//Eve",
  R1: "//Ferdie",
  R2: "//Alice//stash",
  S: "//Bob//stash",
  F2: "//Eve//account-handoff-browser-setup",
  R1_2: "//Ferdie//account-handoff-browser-setup",
  R2_2: "//Alice//stash//account-handoff-browser-setup",
};
function unsigned(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value))
    throw new Error("Missing exact wallet integer");
  return BigInt(value);
}
export async function injectLocalWallet(
  page: Page,
  connection: NativeConnection,
  allowedOrigin: string,
  setupNamespace?: string,
) {
  if (connection.mode !== "LOCAL")
    throw new Error("Test wallet is restricted to LOCAL");
  await cryptoWaitReady();
  const ring = new Keyring({ type: "sr25519" });
  if (setupNamespace && !/^[a-zA-Z0-9-]+$/.test(setupNamespace))
    throw new Error("Invalid test account namespace");
  const uris = { ...roleUris };
  if (setupNamespace)
    for (const role of ["F2", "R1_2", "R2_2"] as const)
      uris[role] += `//${setupNamespace}`;
  const pairs = Object.fromEntries(
    Object.entries(uris).map(([role, uri]) => [role, ring.addFromUri(uri)]),
  ) as Record<LocalRole, ReturnType<Keyring["addFromUri"]>>;
  const accounts = (Object.keys(roleUris) as LocalRole[]).map((role) => ({
    address: account(pairs[role].address),
    name: `${role} · LOCAL test`,
    type: "sr25519",
  }));
  const requests: WalletRequestLog[] = [];
  const rejected: LocalRole[] = [];
  walletTraces.set(page, { requests, rejected });
  let rejectNext = false;
  await page.exposeBinding(
    "__signAccountHandoffLocalPayload",
    async (source, untrusted: unknown) => {
      if (new URL(source.page.url()).origin !== allowedOrigin)
        throw new Error(
          "Unexpected browser origin attempted LOCAL test signing",
        );
      if (
        !untrusted ||
        typeof untrusted !== "object" ||
        Array.isArray(untrusted)
      )
        throw new Error("Invalid native wallet request");
      const payload = untrusted as SignerPayloadJSON;
      if (
        typeof payload.address !== "string" ||
        typeof payload.method !== "string" ||
        payload.withSignedTransaction !== false
      )
        throw new Error("Signature-only native request required");
      const fingerprint = await connection.fingerprint();
      if (
        payload.genesisHash.toLowerCase() !== fingerprint.genesis.toLowerCase()
      )
        throw new Error("Test wallet refuses a foreign genesis");
      if (
        unsigned(payload.specVersion) !== BigInt(fingerprint.specVersion) ||
        unsigned(payload.transactionVersion) !==
          BigInt(fingerprint.transactionVersion)
      )
        throw new Error("Runtime changed since the reviewed payload");
      if (
        JSON.stringify(payload.signedExtensions) !==
        JSON.stringify(fingerprint.signedExtensions)
      )
        throw new Error("Signed extension order changed");
      const role = (Object.keys(pairs) as LocalRole[]).find(
        (candidate) =>
          account(pairs[candidate].address) === account(payload.address),
      );
      if (!role)
        throw new Error(
          "Payload signer is outside the disposable LOCAL identities",
        );
      if (rejectNext) {
        rejectNext = false;
        rejected.push(role);
        return { localTestRejected: true };
      }
      const extension = new ExtraSignedExtension(connection.api, {
        signerAddress: payload.address,
      });
      await extension.fromPayload(payload);
      const raw = hex(extension.toRawPayload(payload.method).data);
      const signature = u8aToHex(
        pairs[role].sign(signatureBytes(raw), { withType: true }),
      );
      requests.push({
        role,
        address: account(payload.address),
        callHash: blake2AsHex(payload.method),
        nonce: String(payload.nonce),
        sequence: requests.length + 1,
      });
      return { id: requests.length, signature };
    },
  );
  await page.addInitScript(
    ({ items }) => {
      const sign = (
        window as unknown as {
          __signAccountHandoffLocalPayload(payload: unknown): Promise<unknown>;
        }
      ).__signAccountHandoffLocalPayload;
      window.injectedWeb3 = {
        "account-handoff-local-test": {
          version: "test-only",
          async enable() {
            return {
              accounts: {
                async get() {
                  return items.map((item) => ({ ...item }));
                },
                async subscribe(callback) {
                  callback(items.map((item) => ({ ...item })));
                  return () => {};
                },
              },
              signer: {
                async signPayload(payload) {
                  const response = await sign(payload);
                  if (
                    response &&
                    typeof response === "object" &&
                    "localTestRejected" in response
                  ) {
                    throw Object.assign(
                      new Error("LOCAL test wallet: user rejected the request"),
                      { code: 4001 },
                    );
                  }
                  return response;
                },
              },
            };
          },
        },
      };
    },
    { items: accounts },
  );
  return {
    accounts: Object.fromEntries(
      accounts.map((entry, index) => [
        (Object.keys(roleUris) as LocalRole[])[index]!,
        entry.address,
      ]),
    ) as Record<LocalRole, string>,
    requests,
    rejected,
    rejectNextRequest() {
      rejectNext = true;
    },
  };
}
