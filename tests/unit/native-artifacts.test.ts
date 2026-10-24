import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "../..");
const script = join(project, "scripts/dev/verify-generated-native.mjs");
const roots: string[] = [];
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const prefix = "packages/native-adapter/generated/account-handoff-local/";
function run(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ah-native-artifacts-"));
  roots.push(root);
  mkdirSync(join(root, prefix), { recursive: true });
  mkdirSync(join(root, "packages/native-adapter/metadata"), {
    recursive: true,
  });
  const files = ["index.d.ts", "types.d.ts"].map((name) => {
    const path = prefix + name,
      contents = `export type ${name.split(".")[0]} = string;\n`;
    writeFileSync(join(root, path), contents);
    return { path, sha256: sha(contents) };
  });
  const metadata = Buffer.from("6d6574611000", "hex");
  writeFileSync(
    join(root, "packages/native-adapter/metadata/local.scale"),
    metadata,
  );
  const manifest = {
    generator: "dedot@1.4.0",
    sourceCommit: "a".repeat(40),
    metadataSha256: sha(metadata),
    runtimeCodeHash: `0x${"12".repeat(32)}`,
    files,
    generatedNativeTypesSha256: sha(JSON.stringify(files)),
  };
  const save = () =>
    writeFileSync(
      join(root, "packages/native-adapter/generated-manifest.json"),
      JSON.stringify(manifest),
    );
  save();
  return { root, manifest, save };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe("offline generated native artifact integrity", () => {
  it("verifies the committed real native declaration tree and exact metadata", () => {
    const result = run(project);
    expect(result.status, result.stderr).toBe(0);
    const expected = JSON.parse(
      readFileSync(
        join(project, "packages/native-adapter/generated-manifest.json"),
        "utf8",
      ),
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "VERIFIED",
      files: expected.files.length,
      generatedNativeTypesSha256: expected.generatedNativeTypesSha256,
      metadataSha256: expected.metadataSha256,
    });
  });
  it.each(["declaration", "metadata", "aggregate"])(
    "rejects a changed %s digest",
    (target) => {
      const { root, manifest, save } = fixture();
      if (target === "declaration")
        writeFileSync(
          join(root, manifest.files[0]!.path),
          "tampered declaration",
        );
      if (target === "metadata")
        writeFileSync(
          join(root, "packages/native-adapter/metadata/local.scale"),
          "tampered metadata",
        );
      if (target === "aggregate") {
        manifest.generatedNativeTypesSha256 = "0".repeat(64);
        save();
      }
      const result = run(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("SHA256 mismatch");
    },
  );
  it.each(["extra", "missing"])("rejects an %s generated file", (kind) => {
    const { root, manifest } = fixture();
    if (kind === "extra")
      writeFileSync(join(root, prefix, "extra.d.ts"), "export {};");
    else rmSync(join(root, manifest.files[0]!.path));
    expect(run(root).stderr).toContain("file set differs");
  });
  it.each([
    "../outside.d.ts",
    "/tmp/outside.d.ts",
    `${prefix}../outside.d.ts`,
    `${prefix}bad\\file.d.ts`,
  ])("rejects unsafe declared path %s", (path) => {
    const { root, manifest, save } = fixture();
    manifest.files[0]!.path = path;
    save();
    expect(run(root).stderr).toContain("path or file declaration");
  });
  it("rejects symlinked artifacts without reading their target", () => {
    const { root, manifest } = fixture();
    const target = join(root, "outside.d.ts");
    writeFileSync(target, "outside target remains untouched");
    const path = join(root, manifest.files[0]!.path);
    rmSync(path);
    symlinkSync(target, path);
    expect(run(root).stderr).toContain("symlink");
    expect(readFileSync(target, "utf8")).toBe(
      "outside target remains untouched",
    );
  });
  it("rejects duplicate or reordered declarations even with a rewritten aggregate", () => {
    const { root, manifest, save } = fixture();
    manifest.files.reverse();
    manifest.generatedNativeTypesSha256 = sha(JSON.stringify(manifest.files));
    save();
    expect(run(root).stderr).toContain("unique and sorted");
    manifest.files[1] = manifest.files[0]!;
    manifest.generatedNativeTypesSha256 = sha(JSON.stringify(manifest.files));
    save();
    expect(run(root).stderr).toContain("unique and sorted");
  });
});
