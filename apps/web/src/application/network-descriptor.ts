import type { EvidenceRef } from "@account-handoff/contracts";
import type {
  NativeMetadataBinding,
  Hex,
} from "@account-handoff/native-adapter";
import type { LocalDescriptor } from "./models";

/** Public immutable binding. No private wallet or local-chain capabilities are shipped. */
export interface TestnetDescriptor {
  mode: "DEMO";
  nativeRpc: string;
  genesisHash: string;
  runtimeCodeHash: string;
  metadataSha256: string;
  nativeMetadataBinding: NativeMetadataBinding;
  runtime: {
    specName: "portaldot-v3";
    specVersion: number;
    nativeDecimals: 14;
    nativeToEthRatio: "10000";
    autoMap: true;
  };
  contract: NonNullable<LocalDescriptor["contract"]>;
  verification: {
    runtimeCodeHash: Hex;
    metadataSha256: string;
    packageLockSha256: string;
    evidence: EvidenceRef;
    capabilities: string[];
  } | null;
}
export type NetworkDescriptor = LocalDescriptor | TestnetDescriptor;
