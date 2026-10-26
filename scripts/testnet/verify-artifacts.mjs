import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const [binding, proof, deployment] = await Promise.all([
  json("infra/testnet/metadata-binding.json"),
  json("infra/testnet/runtime-verification.json"),
  json("infra/testnet/vestry-deployment.json"),
]);
assert.equal(
  hash(Buffer.from(binding.rawMetadata.slice(2), "hex")),
  binding.metadataSha256,
);
assert.equal(binding.genesis, deployment.genesisHash);
assert.equal(binding.runtimeCodeHash, proof.runtimeCodeHash);
assert.equal(binding.metadataSha256, proof.metadataSha256);
assert.equal(
  hash(await readFile("package-lock.json")),
  proof.packageLockSha256,
);
if (proof.status === "passed") {
  assert.equal(proof.evidenceLocator, "runtime-verification-evidence.json");
  const evidenceBytes = await readFile(
    `infra/testnet/${proof.evidenceLocator}`,
  );
  assert.equal(
    hash(evidenceBytes),
    proof.evidenceSha256,
    "Runtime evidence was changed",
  );
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.runtimeCodeHash, binding.runtimeCodeHash);
  assert.equal(evidence.metadataSha256, binding.metadataSha256);
  assert(
    proof.adapterSources && Object.keys(proof.adapterSources).length > 0,
    "Missing verified adapter sources",
  );
  for (const [path, digest] of Object.entries(proof.adapterSources)) {
    assert(
      path.startsWith("packages/native-adapter/src/") && !path.includes(".."),
      "Invalid adapter source path",
    );
    assert.equal(
      hash(await readFile(path)),
      digest,
      `Reverify the changed adapter: ${path}`,
    );
  }
}
console.log(
  `Testnet artifact bindings verified; runtime validation: ${proof.status}.`,
);
