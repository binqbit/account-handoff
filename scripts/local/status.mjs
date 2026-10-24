import { readRun, output, rpc, main } from "./shared.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  const observe = async (url, method) => {
    try {
      return { status: "available", value: await rpc(url, method) };
    } catch (error) {
      return { status: "unavailable", reason: error.message };
    }
  };
  const [health, version, head, gateway] = await Promise.all([
    observe(run.nativeRpc, "system_health"),
    observe(run.nativeRpc, "state_getRuntimeVersion"),
    observe(run.nativeRpc, "chain_getFinalizedHead"),
    observe(run.gatewayRpc, "eth_chainId"),
  ]);
  output({ run, health, version, finalizedHead: head, gateway });
});
