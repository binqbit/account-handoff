/** Isolated runtime test server. Its upstream connection only supplies fork state. */
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { blake2AsHex } from "@polkadot/util-crypto";
import network from "../../infra/testnet/network.json" with { type: "json" };

const directory = resolve(
  ".agent-workspace/implementation/testnet-pipeline/fork",
);
const tooling = resolve(process.env.AH_TESTNET_FORK_TOOLING ?? directory);
const installed = join(tooling, "node_modules/@acala-network/chopsticks");
const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
if (pkg.version !== "1.5.2")
  throw new Error("Install the pinned Chopsticks 1.5.2 test tool first.");
const load = (path) =>
  import(pathToFileURL(join(installed, "dist/esm", path)).href);
const [{ setupContext }, { createServer }, { handler }] = await Promise.all([
  load("context.js"),
  load("server.js"),
  load("rpc/index.js"),
]);
await mkdir(directory, { recursive: true });
const port = 8059;
const context = await setupContext({
  endpoint: network.nativeRpc,
  block: 195611,
  host: "127.0.0.1",
  port,
  "build-block-mode": "Manual",
  "mock-signature-host": false,
  // Unused StatementStore imports may be unresolved; invoking one still fails execution.
  "allow-unresolved-imports": true,
  "rpc-timeout": 60000,
  db: join(directory, "state.sqlite"),
  resume: process.env.AH_TESTNET_FORK_RESUME === "1",
});
const rpc = handler(context);
const server = await createServer(
  async (request, subscriptions) => {
    // Chopsticks omits this standard RPC. Hash actual fork storage, never fabricate a hash.
    if (request.method === "state_getStorageHash") {
      const value = await rpc(
        { ...request, method: "state_getStorage" },
        subscriptions,
      );
      return value === null ? null : blake2AsHex(value);
    }
    return rpc(request, subscriptions);
  },
  port,
  "127.0.0.1",
);
console.log(
  `FORK_READY ${server.addr}; local execution only, public state at block 195611`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await context.chain.close();
    await server.close();
    process.exit(0);
  });
