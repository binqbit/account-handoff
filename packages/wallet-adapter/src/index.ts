import type { SignerPayloadJSON } from "dedot/types";
import type { WalletAccount, WalletSession } from "./types";
export type { WalletAccount, WalletSession } from "./types";
export { connectWallets } from "./connection";
export type { ConnectWalletOptions } from "./connection";
import { hexToU8a, blake2AsU8a } from "dedot/utils";
import { AccountId32 } from "dedot/codecs";
import {
  cryptoWaitReady,
  ed25519Verify,
  sr25519Verify,
  secp256k1Verify,
} from "@polkadot/util-crypto";

export class WalletRejectedError extends Error {
  override name = "WalletRejectedError";
}
export class WalletGuardError extends Error {
  override name = "WalletGuardError";
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
        "The user rejected the signature. Nothing was submitted.",
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
