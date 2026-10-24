import type { SignerPayloadJSON } from "dedot/types";
import { hexToU8a, blake2AsU8a } from "dedot/utils";
import { AccountId32 } from "dedot/codecs";
import {
  cryptoWaitReady,
  ed25519Verify,
  sr25519Verify,
  secp256k1Verify,
} from "@polkadot/util-crypto";

export interface WalletAccount {
  address: string;
  name?: string;
  type?: string;
  source: string;
}
export interface WalletSession {
  source: string;
  version: string;
  accounts: WalletAccount[];
  signPayload: (payload: SignerPayloadJSON) => Promise<unknown>;
  subscribe: (
    callback: (accounts: WalletAccount[]) => void,
  ) => Promise<() => void>;
}
export class WalletRejectedError extends Error {
  override name = "WalletRejectedError";
}
export class WalletGuardError extends Error {
  override name = "WalletGuardError";
}
interface InjectedAccount {
  address: string;
  name?: string;
  type?: string;
}
interface EnabledWallet {
  accounts: {
    get: () => Promise<InjectedAccount[]>;
    subscribe?: (
      cb: (accounts: InjectedAccount[]) => void,
    ) => Promise<() => void>;
  };
  signer: { signPayload?: (payload: SignerPayloadJSON) => Promise<unknown> };
}
interface Injection {
  version?: string;
  enable: (name: string) => Promise<EnabledWallet>;
}
declare global {
  interface Window {
    injectedWeb3?: Record<string, Injection>;
  }
}

export async function connectWallets(): Promise<WalletSession[]> {
  const providers = window.injectedWeb3;
  if (!providers || Object.keys(providers).length === 0)
    throw new Error(
      "Install a supported native wallet such as SubWallet, then allow Account Handoff to access the signer accounts.",
    );
  const sessions: WalletSession[] = [];
  const errors: string[] = [];
  for (const [source, provider] of Object.entries(providers)) {
    try {
      const enabled = await provider.enable("Account Handoff");
      if (!enabled.signer.signPayload)
        throw new Error("Signature-only native payload signing is unavailable");
      const signPayload = enabled.signer.signPayload.bind(enabled.signer);
      const normalize = (items: InjectedAccount[]) =>
        items.map((item) => ({
          ...item,
          address: new AccountId32(item.address).raw,
          source,
        }));
      const accounts = normalize(await enabled.accounts.get());
      sessions.push({
        source,
        version: provider.version ?? "unknown",
        accounts,
        signPayload,
        subscribe: async (callback) =>
          enabled.accounts.subscribe
            ? enabled.accounts.subscribe((items) => callback(normalize(items)))
            : () => {},
      });
    } catch (error) {
      errors.push(
        `${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!sessions.length)
    throw new Error(
      errors.join("; ") || "No native signing accounts were authorized",
    );
  return sessions;
}

export async function verifyNativeSignature(
  rawPayload: string,
  signature: string,
  publicKey: string,
  expectedType?: string,
): Promise<boolean> {
  if (!/^0x[\da-fA-F]+$/.test(signature)) return false;
  await cryptoWaitReady();
  const sig = hexToU8a(signature);
  let message = hexToU8a(rawPayload);
  if (message.length > 256) message = blake2AsU8a(message, 256);
  const key = hexToU8a(new AccountId32(publicKey).raw);
  const variant = sig[0];
  const payload = sig.slice(1);
  if (
    variant === 0 &&
    sig.length === 65 &&
    (!expectedType || expectedType === "ed25519")
  )
    return ed25519Verify(message, payload, key);
  if (
    variant === 1 &&
    sig.length === 65 &&
    (!expectedType || expectedType === "sr25519")
  )
    return sr25519Verify(message, payload, key);
  if (
    variant === 2 &&
    sig.length === 66 &&
    (!expectedType || expectedType === "ecdsa")
  )
    return secp256k1Verify(message, payload, key, "blake2");
  return false;
}

export async function requestSignature(
  session: WalletSession,
  account: WalletAccount,
  payload: SignerPayloadJSON,
  rawPayload: string,
): Promise<`0x${string}`> {
  if (
    new AccountId32(payload.address).raw !==
    new AccountId32(account.address).raw
  )
    throw new Error("Wallet account changed since review");
  if (payload.withSignedTransaction !== false)
    throw new Error("Signature-only policy is required");
  const frozen = JSON.stringify(payload);
  let response: unknown;
  try {
    response = await session.signPayload(
      JSON.parse(frozen) as SignerPayloadJSON,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (("code" in error && error.code === 4001) ||
        ("name" in error && error.name === "UserRejectedRequestError"))
    )
      throw new WalletRejectedError(
        "Користувач відхилив підпис у гаманці. Нічого не відправлено.",
      );
    throw error;
  }
  if (typeof response !== "object" || response === null)
    throw new Error("Wallet returned an invalid response");
  if ("signedTransaction" in response)
    throw new WalletGuardError(
      "Wallet returned a replacement transaction; this signing route is unsupported",
    );
  if (!("signature" in response) || typeof response.signature !== "string")
    throw new Error("Wallet response has no signature");
  if (
    !(await verifyNativeSignature(
      rawPayload,
      response.signature,
      account.address,
      account.type,
    ))
  )
    throw new WalletGuardError(
      "Wallet signature does not match the reviewed native payload",
    );
  return response.signature as `0x${string}`;
}
