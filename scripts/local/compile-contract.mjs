import { readFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";
import { ROOT, LOCK, hash, atomicJSON, output, main } from "./shared.mjs";

export function compileContract() {
  const source = readFileSync(join(ROOT, LOCK.contract.path), "utf8");
  if (hash(source) !== LOCK.contract.sourceSha256)
    throw new Error(
      "Vestry source differs from the attributed unchanged contract.",
    );
  if (!solc.version().startsWith("0.8.24+"))
    throw new Error("Vestry requires the locked Solidity compiler 0.8.24.");
  const input = {
    language: "Solidity",
    sources: { "Vestry.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "metadata",
          ],
        },
      },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (compiled.errors ?? []).filter(
    (item) => item.severity === "error",
  );
  if (errors.length)
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  const contract = compiled.contracts["Vestry.sol"].Vestry;
  const artifact = {
    contractName: "Vestry",
    sourceSha256: hash(source),
    sourceCommit: LOCK.contract.sourceCommit,
    compiler: solc.version(),
    settings: input.settings,
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    metadata: JSON.parse(contract.metadata),
    compilerInputSha256: hash(JSON.stringify(input)),
  };
  atomicJSON(join(ROOT, "contracts/artifacts/Vestry.json"), artifact);
  return artifact;
}
if (process.argv[1]?.endsWith("/compile-contract.mjs"))
  await main(async () => {
    const artifact = compileContract();
    output({
      status: "COMPILED",
      path: "contracts/artifacts/Vestry.json",
      sourceSha256: artifact.sourceSha256,
      compiler: artifact.compiler,
    });
  });
