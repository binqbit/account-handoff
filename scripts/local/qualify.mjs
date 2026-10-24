import { join } from "node:path";
import { blake2AsHex } from "dedot/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  constants,
} from "node:fs";
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
  until,
  hash,
  main,
  emitDescriptor,
} from "./shared.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  const directory = runDirectory(run.runId);
  const bindingPath = join(directory, "native-metadata-binding.json");
  const qualificationPath = join(directory, "qualification.json");
  const runtimeArtifactsPath = join(directory, "runtime-artifacts.json");
  const oldQualification = existsSync(qualificationPath)
    ? JSON.parse(readFileSync(qualificationPath, "utf8"))
    : null;
  let binding;
  let candidatePath;
  if (existsSync(bindingPath)) {
    binding = JSON.parse(readFileSync(bindingPath, "utf8"));
    if (
      args["metadata-anchor"] &&
      args["metadata-anchor"] !== binding.sourceAnchor.blockHash
    )
      throw new Error(
        "An accepted metadata binding cannot be silently replaced.",
      );
  } else {
    if (oldQualification && !args["metadata-anchor"])
      throw new Error(
        "Existing qualification has no exact metadata provenance. Supply --metadata-anchor for the block containing its identical retained bytes.",
      );
    const sourceAnchor =
      args["metadata-anchor"] ??
      (await until("Finalized metadata source block 1", async () => {
        const finalized = await rpc(run.nativeRpc, "chain_getFinalizedHead");
        const header = await rpc(run.nativeRpc, "chain_getHeader", [finalized]);
        if (BigInt(header.number) < 1n) return null;
        return rpc(run.nativeRpc, "chain_getBlockHash", [1]);
      }));
    const captured = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        join(ROOT, "scripts/local/capture-metadata.ts"),
        run.nativeRpc,
        sourceAnchor,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const capture = JSON.parse(captured.stdout);
    if (
      oldQualification &&
      (capture.metadataSha256 !== oldQualification.metadataSha256 ||
        capture.runtimeCodeHash !== oldQualification.runtimeCodeHash ||
        capture.genesis !== oldQualification.genesis)
    )
      throw new Error(
        "The supplied anchor does not contain the identical previously qualified metadata and runtime.",
      );
    binding = {
      genesis: capture.genesis,
      specVersion: capture.specVersion,
      runtimeCodeHash: capture.runtimeCodeHash,
      metadataSha256: capture.metadataSha256,
      rawMetadata: capture.rawMetadata,
      sourceAnchor: {
        blockHash: capture.blockHash,
        blockNumber: capture.blockNumber,
      },
    };
    candidatePath = join(directory, ".candidate-metadata-binding.json");
    atomicJSON(candidatePath, binding);
  }
  const fingerprintOutput = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      join(ROOT, "scripts/local/fingerprint.ts"),
      run.nativeRpc,
      candidatePath ?? bindingPath,
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
    exactMetadataBinding:
      fingerprint.metadataBinding === "pinned-runtime-code" &&
      fingerprint.metadataSha256 === binding.metadataSha256 &&
      fingerprint.metadataSourceAnchor?.blockHash ===
        binding.sourceAnchor.blockHash,
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
    metadataBinding: "pinned-runtime-code",
    metadataSourceAnchor: binding.sourceAnchor,
  };
  if (report.status !== "IDENTITY_VERIFIED")
    throw new Error(`Runtime qualification failed: ${JSON.stringify(checks)}`);
  if (oldQualification && !existsSync(bindingPath)) {
    for (const [original, backup] of [
      [
        qualificationPath,
        join(directory, "qualification-before-metadata-binding.json"),
      ],
      [
        runtimeArtifactsPath,
        join(directory, "runtime-artifacts-before-metadata-binding.json"),
      ],
    ]) {
      if (!existsSync(backup))
        copyFileSync(original, backup, constants.COPYFILE_EXCL);
      else if (hash(readFileSync(original)) !== hash(readFileSync(backup)))
        throw new Error(
          "A different pre-binding qualification backup already exists.",
        );
    }
  }
  atomicJSON(bindingPath, binding);
  atomicJSON(qualificationPath, report);
  atomicJSON(runtimeArtifactsPath, {
    anchor,
    defaultRpcMetadata: metadata,
    metadata: fingerprint.rawMetadata,
    runtimeCode,
    metadataSourceAnchor: binding.sourceAnchor,
  });
  if (candidatePath) unlinkSync(candidatePath);
  run.genesisHash = genesis;
  run.qualification = report;
  saveRun(run);
  emitDescriptor(run);
  output(report);
});
