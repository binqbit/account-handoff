import testnet from "../../../../infra/testnet/network.json";
import type { RuntimeMode } from "../ui-contract";

const isTestnet = import.meta.env.MODE === "testnet";

export const deployment = {
  isTestnet,
  defaultMode: (isTestnet ? "DEMO" : "LOCAL") as RuntimeMode,
  defaultName: isTestnet ? testnet.name : "Account Handoff LOCAL",
  defaultEndpoint: isTestnet ? testnet.nativeRpc : "ws://127.0.0.1:9944",
  allowedModes: (isTestnet
    ? ["DEMO"]
    : ["LOCAL", "DEMO", "LIVE"]) as readonly RuntimeMode[],
  journalName: isTestnet
    ? "account-handoff:demo:portaldot-v3:ui"
    : "account-handoff:local:ui",
};

export function assertDeploymentMode(mode: RuntimeMode): void {
  if (!deployment.allowedModes.includes(mode))
    throw new Error("This build connects only to PortalDot V3 testnet.");
}

export function assertDeploymentGenesis(genesis: string): void {
  if (deployment.isTestnet && genesis !== testnet.genesisHash)
    throw new Error("The endpoint is not the configured PortalDot V3 testnet.");
}
