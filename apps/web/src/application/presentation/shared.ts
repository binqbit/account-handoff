import type { NativeAccountState } from "@account-handoff/native-adapter";
import type { IdentityView, WorkspaceView } from "../../ui-contract";
import type { ChainView, WorkspaceRecord } from "../models";

export type ParticipantRole = keyof WorkspaceRecord["participants"];
export const eq = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => !!left && !!right && left.toLowerCase() === right.toLowerCase();
export const roleNames: Record<ParticipantRole, string> = {
  A: "First current signer",
  B: "Second current signer",
  C: "Third current signer",
  D: "Replacement signer",
  F: "Funder",
  R1: "First reviewer",
  R2: "Second reviewer",
  S: "Vesting operator",
};
export function stateFor(
  chain: ChainView | null,
  address: string | null,
): NativeAccountState | undefined {
  if (!chain || !address) return undefined;
  return (
    chain.accounts[address] ??
    Object.values(chain.accounts).find((state) => eq(state.address, address))
  );
}
export function mapped(state: NativeAccountState | undefined): boolean {
  return !!state && eq(state.mappedTo, state.address);
}
export function ratioFor(chain: ChainView | null): bigint | null {
  const raw = chain?.localDescriptor?.runtime.nativeToEthRatio;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  return BigInt(raw);
}
export function decimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    return value.toString();
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${sign}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
}
export function identity(
  workspace: WorkspaceRecord,
  address: string,
): IdentityView {
  const role = (
    Object.entries(workspace.participants) as [ParticipantRole, string][]
  ).find(([, account]) => eq(account, address))?.[0];
  return role ? { address, label: roleNames[role] } : { address };
}
export function authority(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): WorkspaceView["authority"] {
  const state = stateFor(chain, workspace.pure);
  if (!state) return "Unknown";
  const known = state.proxies.every(
    (proxy) =>
      proxy.proxyType === "Any" &&
      proxy.delay === 0 &&
      (eq(proxy.delegate, workspace.M0.account) ||
        eq(proxy.delegate, workspace.M1?.account)),
  );
  if (!known) return "Diverged";
  const old = state.proxies.filter((proxy) =>
    eq(proxy.delegate, workspace.M0.account),
  ).length;
  const next = state.proxies.filter((proxy) =>
    eq(proxy.delegate, workspace.M1?.account),
  ).length;
  if (old === 1 && next === 0 && state.proxies.length === 1) return "M0";
  if (old === 0 && next === 1 && state.proxies.length === 1) return "M1";
  if (old === 1 && next === 1 && state.proxies.length === 2)
    return "DualControl";
  return "Diverged";
}
