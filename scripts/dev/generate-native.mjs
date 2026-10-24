import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const run = process.argv[2] ?? "development";
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(run))
  throw new Error("Invalid LOCAL run identifier");
const directory = join(root, ".local-state", run);
const input = JSON.parse(
  readFileSync(join(directory, "runtime-artifacts.json"), "utf8"),
);
const qualification = JSON.parse(
  readFileSync(join(directory, "qualification.json"), "utf8"),
);
if (
  qualification.status !== "IDENTITY_VERIFIED" ||
  qualification.version.specName !== "account-handoff-local"
)
  throw new Error("Qualify the exact LOCAL runtime before type generation");
const metadata = Buffer.from(input.metadata.slice(2), "hex");
const digest = (data) => createHash("sha256").update(data).digest("hex");
if (digest(metadata) !== qualification.metadataSha256)
  throw new Error("Qualified metadata bytes changed");
const source = join(root, "packages/native-adapter/metadata/local.scale");
mkdirSync(resolve(source, ".."), { recursive: true });
writeFileSync(source, metadata);
const output = join(root, "packages/native-adapter/generated");
mkdirSync(output, { recursive: true });
execFileSync(
  process.execPath,
  [
    join(root, "node_modules/dedot/bin/dedot.mjs"),
    "chaintypes",
    "--metadata",
    source,
    "--output",
    output,
    "--chain",
    "AccountHandoffLocal",
    "--dts",
  ],
  { cwd: root, stdio: "inherit" },
);
function files(path) {
  return readdirSync(path).flatMap((name) => {
    const p = join(path, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const entries = files(output)
  .sort()
  .map((path) => ({
    path: relative(root, path),
    sha256: digest(readFileSync(path)),
  }));
const manifest = {
  generator: "dedot@1.4.0",
  sourceCommit: "b76182dd335abcc07b0ff876d4889416a4c08ab7",
  metadataSha256: qualification.metadataSha256,
  runtimeCodeHash: qualification.runtimeCodeHash,
  files: entries,
  generatedNativeTypesSha256: digest(JSON.stringify(entries)),
};
writeFileSync(
  join(root, "packages/native-adapter/generated-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
