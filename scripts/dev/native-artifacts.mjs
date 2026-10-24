import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const generatedPrefix = "packages/native-adapter/generated/";
const sha = /^[0-9a-f]{64}$/;

function regular(root, path, maximumBytes) {
  const parts = relative(root, path).split(sep);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(
        `Native artifact symlink is forbidden: ${relative(root, current)}`,
      );
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximumBytes)
    throw new Error(
      `Invalid or oversized native artifact: ${relative(root, path)}`,
    );
  return readFileSync(path);
}

/** Verifies committed generated artifacts without trusting their declared digest or following symlinks. */
export function verifyGeneratedNativeArtifacts(projectRoot) {
  const root = realpathSync(resolve(projectRoot));
  const manifest = JSON.parse(
    regular(
      root,
      join(root, "packages/native-adapter/generated-manifest.json"),
      1_048_576,
    ).toString("utf8"),
  );
  const keys = [
    "generator",
    "sourceCommit",
    "metadataSha256",
    "runtimeCodeHash",
    "files",
    "generatedNativeTypesSha256",
  ];
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in manifest)) ||
    manifest.generator !== "dedot@1.4.0" ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
    !/^0x[0-9a-f]{64}$/.test(manifest.runtimeCodeHash) ||
    !sha.test(manifest.metadataSha256) ||
    !sha.test(manifest.generatedNativeTypesSha256) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 1 ||
    manifest.files.length > 1024
  )
    throw new Error("Invalid native generated-artifact manifest");
  const listed = [];
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      typeof entry.path !== "string" ||
      !sha.test(entry.sha256) ||
      !entry.path.startsWith(generatedPrefix) ||
      !entry.path.endsWith(".d.ts") ||
      entry.path.length > 512 ||
      entry.path.includes("\\") ||
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Native artifact path or file declaration is invalid");
    listed.push(entry.path);
  }
  if (
    new Set(listed).size !== listed.length ||
    listed.some((path, index) => index > 0 && path <= listed[index - 1])
  )
    throw new Error("Native artifact paths must be unique and sorted");
  const physical = [];
  let visited = 0;
  const walk = (directory) => {
    if (++visited > 2048 || relative(root, directory).length > 512)
      throw new Error("Native artifact directory exceeds traversal bounds");
    if (
      lstatSync(directory).isSymbolicLink() ||
      !lstatSync(directory).isDirectory()
    )
      throw new Error("Native generated directory must be a real directory");
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error("Native artifact symlink is forbidden");
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && name.endsWith(".d.ts"))
        physical.push(relative(root, path).split(sep).join("/"));
      else
        throw new Error(
          `Unexpected file in native generated artifact tree: ${name}`,
        );
      if (physical.length > 1024)
        throw new Error("Native artifact tree exceeds the file bound");
    }
  };
  const generated = join(root, "packages/native-adapter/generated");
  // Verify parents too: a symlinked packages/native-adapter must not redirect the walk.
  for (const part of [
    "packages",
    "packages/native-adapter",
    "packages/native-adapter/generated",
  ])
    if (lstatSync(join(root, part)).isSymbolicLink())
      throw new Error("Native artifact parent symlink is forbidden");
  walk(generated);
  physical.sort();
  if (JSON.stringify(physical) !== JSON.stringify(listed))
    throw new Error(
      "Native generated artifact file set differs from the manifest",
    );
  const entries = manifest.files.map((entry) => {
    const actual = digest(regular(root, join(root, entry.path), 8_388_608));
    if (actual !== entry.sha256)
      throw new Error(`Native artifact SHA256 mismatch: ${entry.path}`);
    return { path: entry.path, sha256: actual };
  });
  if (digest(JSON.stringify(entries)) !== manifest.generatedNativeTypesSha256)
    throw new Error("Native generated type aggregate SHA256 mismatch");
  if (
    digest(
      regular(
        root,
        join(root, "packages/native-adapter/metadata/local.scale"),
        2_097_152,
      ),
    ) !== manifest.metadataSha256
  )
    throw new Error("Native raw metadata SHA256 mismatch");
  return { ...manifest, files: entries };
}
