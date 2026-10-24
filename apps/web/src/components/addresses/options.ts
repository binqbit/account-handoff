import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { isAddress } from "viem";
import type { AppSnapshot } from "../../ui-contract";

export interface AddressOption {
  address: string;
  label: string;
  detail: string;
}
export type AddressKind = "native" | "contract";

export function addressKey(
  value: string,
  kind: AddressKind = "native",
): string | null {
  try {
    const text = value.trim();
    if (kind === "contract") return isAddress(text) ? text.toLowerCase() : null;
    const bytes = decodeAddress(text);
    return bytes.length === 32 ? u8aToHex(bytes) : null;
  } catch {
    return null;
  }
}

export { compactAddress } from "./format";

export function participantOptions(snapshot: AppSnapshot): AddressOption[] {
  const options = snapshot.wallet.accounts.map((account) => ({
    address: account.address,
    label: account.label ?? account.name ?? "Wallet account",
    detail: `Connected wallet · ${account.source}`,
  }));
  const workspace = snapshot.workspace;
  if (workspace) {
    for (const [group, members] of [
      ["Original group M0", workspace.oldController.members],
      ["New group M1", workspace.newController.members],
      ["Grant funder", workspace.funder ? [workspace.funder] : []],
      ["Grant reviewer", workspace.reviewers],
    ] as const) {
      for (const member of members) {
        options.push({
          address: member.address,
          label: member.label ?? group,
          detail: group,
        });
      }
    }
  }
  const unique = new Map<string, AddressOption>();
  for (const option of options) {
    const key = addressKey(option.address);
    if (!key) continue;
    const existing = unique.get(key);
    unique.set(
      key,
      existing
        ? {
            ...existing,
            detail: [
              ...new Set([...existing.detail.split(" · "), option.detail]),
            ].join(" · "),
          }
        : option,
    );
  }
  return [...unique.values()];
}

export function addressError(value: string, kind: AddressKind): string | null {
  if (!value.trim() || addressKey(value, kind)) return null;
  return kind === "contract"
    ? "Enter a 20-byte contract address: 0x followed by 40 hexadecimal characters."
    : "Enter a native SS58 address or a 32-byte AccountId (0x + 64 hexadecimal characters).";
}
