import { existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import {
  LOCK,
  artifactPath,
  runDirectory,
  readRun,
  saveRun,
  emitDescriptor,
  output,
  until,
  rpc,
  main,
  hash,
} from "./shared.mjs";

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
function alive(processInfo) {
  if (!processInfo) return false;
  try {
    process.kill(processInfo.pid, 0);
    return (
      readFileSync(`/proc/${processInfo.pid}/cmdline`, "utf8").split(
        "\0",
      )[0] === processInfo.binary
    );
  } catch {
    return false;
  }
}
async function start(binary, args, log) {
  const fd = openSync(log, "a", 0o600);
  const child = spawn(binary, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, RUST_LOG: "info" },
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  if (!child.pid) throw new Error(`Unable to start ${binary}`);
  return { pid: child.pid, binary, args, startedAt: new Date().toISOString() };
}
await main(async (args) => {
  const run = readRun(args.run ?? "development");
  if (run.status === "retired")
    throw new Error("This run is retired. Create or select a fresh run.");
  if (!existsSync(artifactPath))
    throw new Error("Native artifacts missing. Run npm run local:build first.");
  const artifacts = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (
    artifacts.sourceCommit !== LOCK.source.commit ||
    artifacts.patchSha256 !== LOCK.patch.sha256
  )
    throw new Error("Built artifacts do not match the selected runtime lock.");
  for (const item of Object.values(artifacts.binaries))
    if (!existsSync(item.path) || hash(readFileSync(item.path)) !== item.sha256)
      throw new Error("Native artifact is missing or modified.");
  const directory = runDirectory(run.runId);
  if (!alive(run.processes.native)) {
    await checkPort(run.nativePort);
    run.processes.native = await start(
      artifacts.binaries["substrate-node"].path,
      [
        "--dev",
        "--base-path",
        join(directory, "native"),
        "--rpc-port",
        String(run.nativePort),
        "--listen-addr",
        `/ip4/127.0.0.1/tcp/${run.peerPort}`,
        "--no-telemetry",
        "--no-prometheus",
        "--rpc-cors",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4175,http://127.0.0.1:4175",
        "--state-pruning",
        "archive",
        "--blocks-pruning",
        "archive",
      ],
      join(directory, "native.log"),
    );
    run.status = "starting";
    saveRun(run);
    emitDescriptor(run, { activate: true });
  }
  const version = await until("Native runtime", async () => {
    const version = await rpc(run.nativeRpc, "state_getRuntimeVersion");
    if (
      version.specName !== LOCK.runtime.specName ||
      version.specVersion !== LOCK.runtime.specVersion
    )
      throw new Error("Runtime identity mismatch.");
    return version;
  });
  if (!alive(run.processes.gateway)) {
    await checkPort(run.gatewayPort);
    run.processes.gateway = await start(
      artifacts.binaries["eth-rpc"].path,
      [
        "--dev",
        "--base-path",
        join(directory, "gateway"),
        "--node-rpc-url",
        run.nativeRpc,
        "--rpc-port",
        String(run.gatewayPort),
        "--no-prometheus",
        "--rpc-cors",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4175,http://127.0.0.1:4175",
      ],
      join(directory, "gateway.log"),
    );
    saveRun(run);
  }
  const chainId = await until("EVM gateway", () =>
    rpc(run.gatewayRpc, "eth_chainId"),
  );
  if (Number(BigInt(chainId)) !== LOCK.runtime.chainId)
    throw new Error("Gateway chain ID mismatch.");
  run.status = "running";
  run.buildHash = artifacts.buildHash;
  run.lastStartedAt = new Date().toISOString();
  run.genesisHash = await rpc(run.nativeRpc, "chain_getBlockHash", [0]);
  run.namespace = `account-handoff:local:${run.genesisHash}:${run.runId}:${run.generation}`;
  saveRun(run);
  emitDescriptor(run, { activate: true });
  output({
    status: "RUNNING",
    run,
    observedRuntime: version,
    gatewayChainId: chainId,
  });
});
