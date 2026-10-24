import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(
  root,
  process.argv[2] || "private-docs/Account Handoff Testnet.zip",
);
if (!output.endsWith(".zip"))
  throw new Error("The output must be a .zip file.");
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`Package input must not be a symlink: ${path}`);
    if (entry.isDirectory())
      files.push(...(await listFiles(path, `${prefix}${entry.name}/`)));
    else if (entry.isFile()) files.push(`${prefix}${entry.name}`);
    else throw new Error(`Unexpected package input: ${path}`);
  }
  return files;
}

// This target never reads .env, private-docs contents or the agent workspace.
run("npm", ["run", "build:testnet"]);
const assets = await listFiles(join(root, "dist-testnet"));
if (!assets.includes("index.html"))
  throw new Error("Missing built index.html.");
for (const path of assets)
  if (
    path !== "index.html" &&
    !(
      path.startsWith("assets/") &&
      [
        ".js",
        ".css",
        ".svg",
        ".png",
        ".jpg",
        ".webp",
        ".woff2",
        ".wasm",
      ].includes(extname(path))
    )
  )
    throw new Error(`Unapproved public build file: ${path}`);

await mkdir(join(root, "build"), { recursive: true });
await mkdir(dirname(output), { recursive: true });
const staging = await mkdtemp(join(root, "build/testnet-package-"));
const name = "Account Handoff Testnet";
const directory = join(staging, name);
const temporaryZip = join(dirname(output), `.testnet-${randomUUID()}.zip`);
try {
  await mkdir(directory);
  for (const path of assets) {
    const destination = join(directory, "www", path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, "dist-testnet", path), destination);
  }
  for (const file of [
    "serve.mjs",
    "Dockerfile",
    "compose.yaml",
    ".dockerignore",
    "README.md",
    "network.json",
  ])
    await copyFile(join(root, "infra/testnet", file), join(directory, file));
  const files = {};
  for (const path of await listFiles(directory))
    files[path] = digest(await readFile(join(directory, path)));
  await writeFile(
    join(directory, "release.json"),
    JSON.stringify(
      {
        format: "account-handoff-testnet-release-v1",
        builtAt: new Date().toISOString(),
        source: {
          commit: git("rev-parse", "HEAD"),
          dirty: git("status", "--porcelain").length > 0,
        },
        mode: "testnet",
        network: JSON.parse(
          await readFile(join(directory, "network.json"), "utf8"),
        ),
        capabilities: {
          readOnlyPreview: true,
          testnetTransactionsQualified: false,
          contractAddress: null,
        },
        files,
      },
      null,
      2,
    ) + "\n",
  );
  const checksums = [];
  for (const path of await listFiles(directory))
    checksums.push(`${digest(await readFile(join(directory, path)))}  ${path}`);
  await writeFile(join(directory, "SHA256SUMS"), checksums.join("\n") + "\n");
  run("zip", ["-X", "-q", "-r", temporaryZip, name], staging);
  run("unzip", ["-tq", temporaryZip]);
  const checksum = digest(await readFile(temporaryZip));
  await rename(temporaryZip, output);
  await writeFile(
    `${output}.sha256`,
    `${checksum}  ${output.split(/[\\/]/).at(-1)}\n`,
  );
  console.log(
    JSON.stringify({
      archive: output,
      sha256: checksum,
      files: checksums.length + 1,
    }),
  );
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(temporaryZip, { force: true });
}
