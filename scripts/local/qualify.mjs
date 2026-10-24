import { join } from "node:path";
import { blake2AsHex } from "dedot/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import {
  ROOT,
  artifactPath,
  readRun,
  saveRun,
  LOCK,
  runDirectory,
  atomicJSON,
  output,
  rpc,
  hash,
  main,
  emitDescriptor,
} from "./shared.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  const fingerprintOutput = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      join(ROOT, "scripts/local/fingerprint.ts"),
      run.nativeRpc,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const fingerprint = JSON.parse(fingerprintOutput.stdout);
  const artifacts = JSON.parse(readFileSync(artifactPath, "utf8"));
  const anchor = fingerprint.anchor.hash;
  const [version, metadata, runtimeCode, properties, genesis, gatewayChainId] =
    await Promise.all([
      rpc(run.nativeRpc, "state_getRuntimeVersion", [anchor]),
      rpc(run.nativeRpc, "state_getMetadata", [anchor]),
      rpc(run.nativeRpc, "state_getStorage", ["0x3a636f6465", anchor]),
      rpc(run.nativeRpc, "system_properties"),
      rpc(run.nativeRpc, "chain_getBlockHash", [0]),
      rpc(run.gatewayRpc, "eth_chainId"),
    ]);
  const checks = {
    nativeIdentity:
      version.specName === LOCK.runtime.specName &&
      version.specVersion === LOCK.runtime.specVersion,
    nativeDecimals:
      Number(properties.tokenDecimals) === LOCK.runtime.nativeDecimals,
    gatewayChainId: Number(BigInt(gatewayChainId)) === LOCK.runtime.chainId,
    runtimeCodePresent:
      typeof runtimeCode === "string" && runtimeCode.length > 2,
    runtimeMatchesBuild:
      blake2AsHex(runtimeCode) === artifacts.runtimeWasm?.codeHash,
    metadataPresent:
      typeof metadata === "string" && metadata.startsWith("0x6d657461"),
  };
  const report = {
    scope:
      "LOCAL runtime identity and raw artifacts; composed-operation gates are separate",
    status: Object.values(checks).every(Boolean)
      ? "IDENTITY_VERIFIED"
      : "FAILED",
    observedAt: new Date().toISOString(),
    runId: run.runId,
    generation: run.generation,
    anchor,
    genesis,
    version,
    properties,
    gatewayChainId,
    checks,
    metadataSha256: fingerprint.metadataSha256,
    metadataHash: fingerprint.metadataHash,
    metadataVersion: fingerprint.metadataVersion,
    runtimeCodeHash: blake2AsHex(runtimeCode),
    runtimeCodeSha256: hash(Buffer.from(runtimeCode.slice(2), "hex")),
  };
  atomicJSON(join(runDirectory(run.runId), "qualification.json"), report);
  atomicJSON(join(runDirectory(run.runId), "runtime-artifacts.json"), {
    anchor,
    defaultRpcMetadata: metadata,
    metadata: fingerprint.rawMetadata,
    runtimeCode,
  });
  if (report.status !== "IDENTITY_VERIFIED")
    throw new Error(`Runtime qualification failed: ${JSON.stringify(checks)}`);
  run.genesisHash = genesis;
  run.qualification = report;
  saveRun(run);
  emitDescriptor(run);
  output(report);
});
