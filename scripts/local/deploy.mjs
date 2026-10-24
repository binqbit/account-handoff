import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  readRun,
  runDirectory,
  atomicJSON,
  output,
  rpc,
  until,
  hash,
  main,
  emitDescriptor,
} from "./shared.mjs";
import { compileContract } from "./compile-contract.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  if (run.status !== "running" || !run.qualification)
    throw new Error(
      "Run local:up and local:qualify before contract deployment.",
    );
  const artifact = compileContract();
  const manifestPath = join(runDirectory(run.runId), "deployment.json");
  async function finalizeDeployment(manifest) {
    if (
      manifest.sourceSha256 !== artifact.sourceSha256 ||
      manifest.bytecodeSha256 !==
        hash(Buffer.from(artifact.bytecode.slice(2), "hex"))
    )
      throw new Error(
        "Deployment request does not match the current locked contract artifact.",
      );
    if (!manifest.transactionHash)
      throw new Error(
        "Previous deployment request has an unknown outcome; no automatic retry.",
      );
    const receipt = await until(
      "Vestry deployment receipt",
      () =>
        rpc(run.gatewayRpc, "eth_getTransactionReceipt", [
          manifest.transactionHash,
        ]),
      180_000,
    );
    if (
      receipt.status !== "0x1" ||
      !receipt.contractAddress ||
      receipt.to !== null ||
      receipt.from.toLowerCase() !== manifest.from.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !==
        manifest.transactionHash.toLowerCase()
    )
      throw new Error(
        `Deployment execution failed or returned a different transaction: ${JSON.stringify(receipt)}`,
      );
    const finalized = await until(
      "Finalized contract deployment",
      async () => {
        const block = await rpc(run.gatewayRpc, "eth_getBlockByNumber", [
          "finalized",
          false,
        ]);
        return block && BigInt(block.number) >= BigInt(receipt.blockNumber)
          ? block
          : null;
      },
      180_000,
    );
    const canonical = await rpc(run.gatewayRpc, "eth_getBlockByNumber", [
      receipt.blockNumber,
      false,
    ]);
    if (canonical?.hash !== receipt.blockHash)
      throw new Error(
        "Deployment receipt is not on the finalized canonical EVM chain.",
      );
    const code = await rpc(run.gatewayRpc, "eth_getCode", [
      receipt.contractAddress,
      "finalized",
    ]);
    if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
      throw new Error(
        "Finalized deployed runtime bytecode differs from unchanged Vestry artifact.",
      );
    const nativeFinalizedHash = await rpc(
      run.nativeRpc,
      "chain_getFinalizedHead",
    );
    const nativeFinalizedHeader = await rpc(run.nativeRpc, "chain_getHeader", [
      nativeFinalizedHash,
    ]);
    Object.assign(manifest, {
      status: "VERIFIED",
      contractAddress: receipt.contractAddress,
      receipt,
      finalizedEvm: { hash: finalized.hash, number: finalized.number },
      finalizedNative: {
        hash: nativeFinalizedHash,
        number: nativeFinalizedHeader.number,
      },
      verifiedAt: new Date().toISOString(),
    });
    atomicJSON(manifestPath, manifest);
    emitDescriptor(run);
    return manifest;
  }
  if (existsSync(manifestPath)) {
    const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (previous.generation !== run.generation)
      throw new Error("Deployment belongs to a different run generation.");
    output(await finalizeDeployment(previous));
    return;
  }
  const accounts = await rpc(run.gatewayRpc, "eth_accounts");
  const from = args.from ?? accounts[0];
  if (
    !from ||
    !accounts.some((account) => account.toLowerCase() === from.toLowerCase())
  )
    throw new Error("Select one of the isolated gateway development accounts.");
  const transaction = { from, data: artifact.bytecode, value: "0x0" };
  const gas = await rpc(run.gatewayRpc, "eth_estimateGas", [transaction]);
  const nonce = await rpc(run.gatewayRpc, "eth_getTransactionCount", [
    from,
    "pending",
  ]);
  const manifest = {
    formatVersion: 1,
    mode: "LOCAL",
    runId: run.runId,
    generation: run.generation,
    status: "REQUESTED",
    from,
    nonce,
    gas,
    sourceSha256: artifact.sourceSha256,
    compiler: artifact.compiler,
    bytecodeSha256: hash(Buffer.from(artifact.bytecode.slice(2), "hex")),
    artifactPath: "contracts/artifacts/Vestry.json",
    genesisHash: run.genesisHash,
    requestedAt: new Date().toISOString(),
  };
  atomicJSON(manifestPath, manifest);
  // This explicit command is the only gateway deployment side effect. Persist request first.
  const transactionHash = await rpc(
    run.gatewayRpc,
    "eth_sendTransaction",
    [{ ...transaction, gas, nonce }],
    60_000,
  );
  manifest.transactionHash = transactionHash;
  manifest.status = "SUBMITTED";
  atomicJSON(manifestPath, manifest);
  output(await finalizeDeployment(manifest));
});
