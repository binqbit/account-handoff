import type { NetworkView } from "../ui-contract";

export function networkReady(network: NetworkView): boolean {
  return network.connected && !network.checking && !network.reconnecting;
}

export function networkStatus(network: NetworkView): string {
  if (
    network.reconnecting ||
    (network.checking && !network.connected && network.updatedAt)
  )
    return "Reconnecting…";
  if (network.checking)
    return network.connected ? "Checking network…" : "Connecting…";
  if (networkReady(network)) return "RPC online";
  if (network.error && network.retryable === false)
    return "Verification required";
  return network.updatedAt ? "Connection interrupted" : "Network disconnected";
}
