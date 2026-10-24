import { expect, test } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("recovered deployment verifies canonical finality and code before becoming usable", async () => {
  const artifact = JSON.parse(
    readFileSync(join(root, "contracts/artifacts/Vestry.json"), "utf8"),
  );
  const runId = `deployment-test-${randomUUID()}`;
  const directory = join(root, ".local-state", runId);
  const transactionHash = `0x${"11".repeat(32)}`;
  const receiptHash = `0x${"22".repeat(32)}`;
  const finalizedHash = `0x${"33".repeat(32)}`;
  const from = `0x${"44".repeat(20)}`;
  const contractAddress = `0x${"55".repeat(20)}`;
  const calls: { method: string; params: unknown[] }[] = [];
  const receipt = {
    status: "0x1",
    contractAddress,
    transactionHash,
    from,
    to: null,
    blockHash: receiptHash,
    blockNumber: "0x1",
  };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const call = JSON.parse(body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      calls.push(call);
      let result: unknown;
      switch (call.method) {
        case "eth_getTransactionReceipt":
          result = receipt;
          break;
        case "eth_getBlockByNumber":
          result =
            call.params[0] === "finalized"
              ? { number: "0x10", hash: finalizedHash }
              : { number: "0x1", hash: receiptHash };
          break;
        case "eth_getCode":
          result = artifact.deployedBytecode;
          break;
        case "chain_getFinalizedHead":
          result = finalizedHash;
          break;
        case "chain_getHeader":
          result = { number: "0x10" };
          break;
        default:
          response.writeHead(500);
          response.end("unexpected method");
          return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a loopback test server");
  const endpoint = `http://127.0.0.1:${address.port}`;
  mkdirSync(directory, { recursive: true });
  const descriptorPath = join(root, "apps/web/public/local-run.json");
  const descriptorBefore = existsSync(descriptorPath)
    ? readFileSync(descriptorPath, "utf8")
    : null;
  try {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        owner: "account-handoff",
        mode: "LOCAL",
        runId,
        generation: 1,
        status: "running",
        nativeRpc: endpoint,
        gatewayRpc: endpoint,
        qualification: { status: "IDENTITY_VERIFIED" },
      }),
    );
    writeFileSync(
      join(directory, "deployment.json"),
      JSON.stringify({
        generation: 1,
        status: "SUBMITTED",
        transactionHash,
        from,
        sourceSha256: artifact.sourceSha256,
        bytecodeSha256: sha(Buffer.from(artifact.bytecode.slice(2), "hex")),
      }),
    );
    await promisify(execFile)(
      process.execPath,
      ["scripts/local/deploy.mjs", "--run", runId],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    );
    const recovered = JSON.parse(
      readFileSync(join(directory, "deployment.json"), "utf8"),
    );
    expect(recovered.status).toBe("VERIFIED");
    expect(recovered.contractAddress).toBe(contractAddress);
    expect(recovered.finalizedEvm).toEqual({
      hash: finalizedHash,
      number: "0x10",
    });
    expect(
      calls.some(
        (call) =>
          call.method === "eth_getCode" && call.params[1] === "finalized",
      ),
    ).toBe(true);
    expect(calls.some((call) => call.method === "eth_sendTransaction")).toBe(
      false,
    );
    expect(
      existsSync(descriptorPath) ? readFileSync(descriptorPath, "utf8") : null,
    ).toBe(descriptorBefore);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    rmSync(directory, { recursive: true, force: true });
  }
});
