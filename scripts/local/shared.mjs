import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { keccak256 } from "viem";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const STATE = join(ROOT, ".local-state");
export const LOCK = JSON.parse(
  readFileSync(join(ROOT, "infra/local/runtime.lock.json"), "utf8"),
);
export const sourcePath = join(
  ROOT,
  ".agent-workspace/local-runtime/polkadot-sdk",
);
export const artifactPath = join(ROOT, "artifacts/local/build.json");
export const delay = (ms) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
export const hash = (data) => createHash("sha256").update(data).digest("hex");
export function options(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!name.startsWith("--"))
      throw new Error(`Expected --option, got ${name}`);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      result[name.slice(2)] = value;
      index++;
    } else result[name.slice(2)] = true;
  }
  return result;
}
export function runId(value = "development") {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw new Error(
      "Run ID must be 1–64 lowercase letters, digits or hyphens.",
    );
  return value;
}
export function runDirectory(id) {
  const target = join(STATE, runId(id));
  const parent = existsSync(STATE) ? realpathSync(STATE) : STATE;
  if (
    parent !== STATE ||
    (existsSync(target) && realpathSync(target) !== target)
  )
    throw new Error("LOCAL state must not traverse symlinks.");
  return target;
}
export function readRun(id) {
  const directory = runDirectory(id);
  const data = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  if (
    data.mode !== "LOCAL" ||
    data.runId !== id ||
    data.owner !== "account-handoff"
  )
    throw new Error("Invalid or foreign LOCAL manifest.");
  return data;
}
export function atomicJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(data, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    { mode: 0o600, flush: true },
  );
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function saveRun(data) {
  atomicJSON(join(runDirectory(data.runId), "manifest.json"), data);
}
export function output(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
export function emitDescriptor(data, { activate = false } = {}) {
  const descriptorPath = join(ROOT, "apps/web/public/local-run.json");
  if (!activate) {
    if (!existsSync(descriptorPath)) return;
    const active = JSON.parse(readFileSync(descriptorPath, "utf8"));
    if (active.runId !== data.runId) return;
  }
  const deploymentPath = join(runDirectory(data.runId), "deployment.json");
  const contractPath = join(ROOT, "contracts/artifacts/Vestry.json");
  let deployment;
  let contract;
  let generated;
  const generatedPath = join(
    ROOT,
    "packages/native-adapter/generated-manifest.json",
  );
  if (existsSync(generatedPath)) {
    const manifest = JSON.parse(readFileSync(generatedPath, "utf8"));
    if (
      manifest.metadataSha256 === data.qualification?.metadataSha256 &&
      manifest.runtimeCodeHash === data.qualification?.runtimeCodeHash
    )
      generated = manifest;
  }
  if (existsSync(deploymentPath) && existsSync(contractPath)) {
    const manifest = JSON.parse(readFileSync(deploymentPath, "utf8"));
    if (
      manifest.status === "VERIFIED" &&
      manifest.generation === data.generation
    ) {
      deployment = manifest;
      contract = JSON.parse(readFileSync(contractPath, "utf8"));
    }
  }
  atomicJSON(descriptorPath, {
    mode: "LOCAL",
    runId: data.runId,
    generation: data.generation,
    status: data.status,
    nativeRpc: data.nativeRpc,
    gatewayRpc: data.gatewayRpc,
    namespace: data.namespace,
    runtime: LOCK.runtime,
    buildHash: data.buildHash ?? null,
    sourceCommit: LOCK.source.commit,
    qualified:
      data.status === "running" &&
      data.qualification?.status === "IDENTITY_VERIFIED",
    genesisHash: data.genesisHash ?? null,
    metadataHash: data.qualification?.metadataHash ?? null,
    metadataSha256: data.qualification?.metadataSha256 ?? null,
    metadataVersion: data.qualification?.metadataVersion ?? null,
    runtimeCodeHash: data.qualification?.runtimeCodeHash ?? null,
    generatedNativeTypesSha256: generated?.generatedNativeTypesSha256 ?? null,
    capabilities:
      data.capabilities?.generation === data.generation &&
      data.capabilities?.metadataSha256 ===
        data.qualification?.metadataSha256 &&
      data.capabilities?.runtimeCodeHash ===
        data.qualification?.runtimeCodeHash &&
      data.capabilities?.generatedNativeTypesSha256 ===
        generated?.generatedNativeTypesSha256
        ? data.capabilities
        : null,
    contract:
      deployment && contract
        ? {
            address: deployment.contractAddress,
            sourceSha256: contract.sourceSha256,
            runtimeCodeHash: keccak256(contract.deployedBytecode),
            abiSha256: hash(JSON.stringify(contract.abi)),
          }
        : null,
  });
}
export async function command(
  binary,
  args,
  { cwd = ROOT, env = process.env, log } = {},
) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: log ? ["ignore", log, log] : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolveCommand()
        : reject(new Error(`${binary} exited ${code ?? signal}`)),
    );
  });
}
export async function rpc(url, method, params = [], timeoutMs = 10_000) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
    throw new Error("LOCAL tools only connect to loopback endpoints.");
  parsed.protocol = parsed.protocol === "ws:" ? "http:" : parsed.protocol;
  const response = await fetch(parsed, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  if (!Object.hasOwn(data, "result"))
    throw new Error(`${method}: missing RPC result`);
  return data.result;
}
export async function until(label, check, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(500);
  }
  throw new Error(
    `${label} did not become ready: ${last?.message ?? "condition remained false"}`,
  );
}
export function inside(parent, path) {
  const relativePath = relative(parent, path);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    ) &&
    !isAbsolute(relativePath)
  );
}
export async function main(action) {
  try {
    await action(options());
  } catch (error) {
    output({ status: "FAILED", message: error.message });
    process.exitCode = 1;
  }
}
