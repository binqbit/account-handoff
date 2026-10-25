import network from "../../../../infra/testnet/network.json";
import deployment from "../../../../infra/testnet/vestry-deployment.json";
import rawBinding from "../../../../infra/testnet/metadata-binding.json";
import artifact from "../../../../contracts/artifacts/Vestry.json";
import verification from "../../../../infra/testnet/runtime-verification.json";
import { canonicalJson, sha256 } from "@account-handoff/contracts";
import { hex, validateMetadataBinding } from "@account-handoff/native-adapter";
import { keccak256 } from "viem";
import type { TestnetDescriptor } from "./network-descriptor";

export async function readTestnetDescriptor(): Promise<TestnetDescriptor> {
  const binding = await validateMetadataBinding(
    rawBinding as Parameters<typeof validateMetadataBinding>[0],
  );
  if (
    binding.genesis !== network.genesisHash ||
    deployment.address !== network.contractAddress ||
    deployment.sourceSha256 !== artifact.sourceSha256 ||
    !deployment.finalized
  )
    throw new Error(
      "The bundled testnet deployment and runtime binding disagree.",
    );
  return {
    mode: "DEMO",
    nativeRpc: network.nativeRpc,
    genesisHash: network.genesisHash,
    runtimeCodeHash: binding.runtimeCodeHash,
    metadataSha256: binding.metadataSha256,
    nativeMetadataBinding: binding,
    runtime: {
      specName: "portaldot-v3",
      specVersion: binding.specVersion,
      nativeDecimals: 14,
      nativeToEthRatio: "10000",
      autoMap: true,
    },
    contract: {
      address: hex(deployment.address, 20),
      sourceSha256: artifact.sourceSha256,
      abiSha256: await sha256(canonicalJson(artifact.abi)),
      runtimeCodeHash: keccak256(hex(artifact.deployedBytecode)),
    },
    verification:
      verification.status === "passed"
        ? {
            runtimeCodeHash: hex(verification.runtimeCodeHash, 32),
            metadataSha256: verification.metadataSha256,
            packageLockSha256: verification.packageLockSha256,
            capabilities: verification.capabilities,
            evidence: {
              kind: "local_artifact",
              locator: verification.evidenceLocator,
              sourceId: verification.runtimeCodeHash,
              contentSha256: verification.evidenceSha256,
            },
          }
        : null,
  };
}
