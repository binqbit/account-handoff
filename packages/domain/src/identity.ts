import type {
  AccountId32,
  Controller,
  ProxyTuple,
  AuthorityObservation,
} from "@account-handoff/contracts";
import { DomainError } from "./result.js";

export function normalizeIdentity(input: string | Uint8Array): AccountId32 {
  const text =
    typeof input === "string"
      ? input.toLowerCase()
      : `0x${Array.from(input, (x) => x.toString(16).padStart(2, "0")).join("")}`;
  if (!/^0x[0-9a-f]{64}$/.test(text))
    throw new DomainError(
      "InvalidAccount",
      "A canonical AccountId32 contains exactly 32 bytes",
    );
  return text;
}

export function isNormalAccount(input: AccountId32): boolean {
  return !normalizeIdentity(input).endsWith("ee".repeat(12));
}

export interface IdentityCodec {
  deriveMultisig(
    members: readonly AccountId32[],
    threshold: number,
  ): AccountId32;
}

export function makeController(
  members: readonly AccountId32[],
  threshold: number,
  role: "M0" | "M1",
  codec: IdentityCodec,
): Controller {
  const canonical = members.map(normalizeIdentity).sort();
  if (canonical.length !== 3 || new Set(canonical).size !== 3)
    throw new DomainError(
      "DuplicateMembers",
      "A controller requires exactly three distinct native accounts",
    );
  if (threshold !== 2)
    throw new DomainError(
      "UnsupportedThreshold",
      "The selected profile requires two of three signers",
    );
  return {
    account: normalizeIdentity(codec.deriveMultisig(canonical, threshold)),
    members: canonical,
    threshold: "2",
    role,
  };
}

export function classifyAuthority(
  tuples: readonly ProxyTuple[] | null,
  m0: AccountId32,
  m1: AccountId32,
): AuthorityObservation["state"] {
  if (tuples === null) return "Unknown";
  const actual = tuples
    .map((t) => `${normalizeIdentity(t.delegate)}:${t.proxyType}:${t.delay}`)
    .sort();
  const a = `${normalizeIdentity(m0)}:Any:0`;
  const b = `${normalizeIdentity(m1)}:Any:0`;
  if (actual.length === 0) return "NotCreated";
  if (actual.length === 1 && actual[0] === a) return "M0Only";
  if (actual.length === 1 && actual[0] === b) return "M1Only";
  if (
    actual.length === 2 &&
    actual.includes(a) &&
    actual.includes(b) &&
    a !== b
  )
    return "DualControl";
  return "UnexpectedSet";
}

export function otherSignatories(
  controller: Controller,
  signer: AccountId32,
): AccountId32[] {
  const who = normalizeIdentity(signer);
  if (!controller.members.includes(who))
    throw new DomainError(
      "NotControllerMember",
      "Selected signer is outside this controller",
    );
  return controller.members.filter((account) => account !== who).sort();
}
