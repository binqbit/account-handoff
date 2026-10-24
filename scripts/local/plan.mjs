import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  LOCK,
  artifactPath,
  runId,
  runDirectory,
  saveRun,
  emitDescriptor,
  output,
  main,
} from "./shared.mjs";

await main(async (args) => {
  const id = runId(args.run ?? "development");
  if (existsSync(join(runDirectory(id), "manifest.json")))
    throw new Error(
      `Run ${id} already exists. Use local:status/up or choose a new --run.`,
    );
  const nativePort = Number(args["native-port"] ?? 9944);
  const gatewayPort = Number(args["gateway-port"] ?? 8545);
  const peerPort = Number(args["peer-port"] ?? nativePort + 20_000);
  for (const port of [nativePort, gatewayPort, peerPort])
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Ports must be integer values from 1024 to 65535.");
  if (new Set([nativePort, gatewayPort, peerPort]).size !== 3)
    throw new Error("Native, gateway and peer ports must differ.");
  const manifest = {
    formatVersion: 1,
    owner: "account-handoff",
    mode: "LOCAL",
    runId: id,
    generation: 1,
    status: "planned",
    createdAt: new Date().toISOString(),
    sourceCommit: LOCK.source.commit,
    nativePort,
    gatewayPort,
    peerPort,
    nativeRpc: `ws://127.0.0.1:${nativePort}`,
    gatewayRpc: `http://127.0.0.1:${gatewayPort}`,
    namespace: `account-handoff:local:${id}:1`,
    processes: {},
    runtime: LOCK.runtime,
  };
  saveRun(manifest);
  output({
    status: "PLANNED",
    manifest,
    artifactsAvailable: existsSync(artifactPath),
    root: ROOT,
  });
});
