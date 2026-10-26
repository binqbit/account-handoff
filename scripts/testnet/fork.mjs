/** Isolated runtime test server. Its upstream connection only supplies fork state. */
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname, sep } from "node:path";
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
const database = resolve(
  process.env.AH_TESTNET_FORK_DATABASE ?? join(directory, "state.sqlite"),
);
if (!database.startsWith(resolve(".agent-workspace") + sep))
  throw new Error("Fork databases must remain in the agent workspace");
await mkdir(dirname(database), { recursive: true });
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
  db: database,
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
    if (request.method === "author_submitAndWatchExtrinsic") {
      const normalized = {
        ...subscriptions,
        subscribe(method, id, onCancel) {
          const callback = subscriptions.subscribe(method, id, onCancel);
          return (value) => {
            // Unit variants on real Substrate RPC are strings. Chopsticks emits {ready:null}.
            const keys =
              value && typeof value === "object" ? Object.keys(value) : [];
            const key = keys.length === 1 ? keys[0] : undefined;
            callback(
              key &&
                ["future", "ready", "dropped", "invalid"].includes(key) &&
                value[key] === null
                ? key
                : value,
            );
          };
        },
      };
      return rpc(request, normalized);
    }
    return rpc(request, subscriptions);
  },
  port,
  "127.0.0.1",
);
console.log(
  `FORK_READY ${server.addr}; local execution only, public state at block 195611`,
);
let heartbeatBusy = false;
const heartbeat = setInterval(async () => {
  if (heartbeatBusy || context.chain.txPool.mode !== "Instant") return;
  heartbeatBusy = true;
  try {
    // Public networks keep producing blocks while a person reviews an operation.
    await context.chain.newBlock({});
  } catch (error) {
    console.error("Local fork heartbeat failed", error);
  } finally {
    heartbeatBusy = false;
  }
}, 6000);
heartbeat.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(heartbeat);
    await context.chain.close();
    await server.close();
    process.exit(0);
  });
