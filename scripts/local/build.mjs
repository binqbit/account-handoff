import {
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  accessSync,
  constants,
  realpathSync,
} from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { execFileSync } from "node:child_process";
import { blake2AsHex } from "dedot/utils";
import {
  ROOT,
  LOCK,
  sourcePath,
  artifactPath,
  atomicJSON,
  hash,
  command,
  output,
  main,
} from "./shared.mjs";

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {
      /* Try the next explicitly configured directory. */
    }
  }
  throw new Error(`Missing required executable ${name}`);
}
function pinnedNixpkgs() {
  const pin = LOCK.build.nixpkgs;
  const reference = `github:${pin.owner}/${pin.repo}/${pin.rev}`;
  const metadata = JSON.parse(
    execFileSync(
      "nix",
      [
        "--extra-experimental-features",
        "nix-command flakes",
        "flake",
        "metadata",
        "--json",
        reference,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  );
  if (
    metadata.locked.rev !== pin.rev ||
    metadata.locked.narHash !== pin.narHash
  )
    throw new Error("Resolved nixpkgs differs from the locked source.");
  return metadata.path;
}
await main(async (args) => {
  if (!existsSync(join(sourcePath, ".git"))) {
    await command("git", ["init", sourcePath]);
    await command("git", [
      "-C",
      sourcePath,
      "remote",
      "add",
      "origin",
      LOCK.source.url,
    ]);
    await command("git", [
      "-C",
      sourcePath,
      "fetch",
      "--depth",
      "1",
      "origin",
      LOCK.source.commit,
    ]);
    await command("git", [
      "-C",
      sourcePath,
      "checkout",
      "--detach",
      "FETCH_HEAD",
    ]);
  }
  const revision = execFileSync(
    "git",
    ["-C", sourcePath, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  if (revision !== LOCK.source.commit)
    throw new Error("LOCAL source checkout is not the pinned revision.");
  if (
    hash(readFileSync(join(sourcePath, "Cargo.lock"))) !==
    LOCK.source.cargoLockSha256
  )
    throw new Error("Pinned Cargo.lock was modified.");
  const patch = readFileSync(join(ROOT, LOCK.patch.path));
  if (hash(patch) !== LOCK.patch.sha256)
    throw new Error("LOCAL patch differs from the reviewed lock.");
  const diff = execFileSync("git", ["-C", sourcePath, "diff", "--binary"]);
  if (diff.length === 0)
    await command("git", [
      "-C",
      sourcePath,
      "apply",
      join(ROOT, LOCK.patch.path),
    ]);
  else if (!diff.equals(patch))
    throw new Error("LOCAL source has changes outside the locked patch.");
  const target = join(sourcePath, "target/release");
  {
    const hostCargo = executable("cargo");
    const hostRustc = executable("rustc");
    const rustVersion = execFileSync("rustc", ["--version"], {
      encoding: "utf8",
    }).trim();
    if (!rustVersion.startsWith(`rustc ${LOCK.build.rust} `))
      throw new Error(
        `Expected Rust ${LOCK.build.rust}; found ${rustVersion}.`,
      );
    const wasmVersion = execFileSync(
      "rustup",
      ["run", LOCK.build.wasmToolchain, "rustc", "--version"],
      { encoding: "utf8" },
    ).trim();
    if (!wasmVersion.startsWith(`rustc ${LOCK.build.wasmToolchain} `))
      throw new Error("The selected runtime-WASM toolchain is unavailable.");
    const wasmRustc = execFileSync(
      "rustup",
      ["which", "--toolchain", LOCK.build.wasmToolchain, "rustc"],
      { encoding: "utf8" },
    ).trim();
    const cargoArgs = [
      "build",
      "--manifest-path",
      join(sourcePath, "Cargo.toml"),
      "--locked",
      "--release",
      "-p",
      "staging-node-cli",
      "--bin",
      "substrate-node",
      "-p",
      "pallet-revive-eth-rpc",
      "--bin",
      "eth-rpc",
    ];
    const env = {
      ...process.env,
      CARGO_BUILD_JOBS: String(LOCK.build.jobs),
      CARGO_PROFILE_RELEASE_DEBUG: "0",
      CFLAGS: "-O2",
      CARGO_TARGET_DIR: join(sourcePath, "target"),
      WASM_BUILD_TOOLCHAIN: LOCK.build.wasmToolchain,
      RUSTC: hostRustc,
      PATH: `${dirname(wasmRustc)}${delimiter}${process.env.PATH ?? ""}`,
    };
    delete env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS;
    const logPath = join(ROOT, ".agent-workspace/local-runtime/build.log");
    const log = openSync(logPath, "a", 0o600);
    try {
      let nixShell;
      try {
        nixShell = executable("nix-shell");
      } catch {
        /* Non-Nix hosts use their qualified C toolchain. */
      }
      if (nixShell) {
        await command(
          nixShell,
          [
            "-I",
            `nixpkgs=${pinnedNixpkgs()}`,
            join(ROOT, "infra/local/shell.nix"),
            "--run",
            `env -u CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS RUSTC=${quote(hostRustc)} ${quote(hostCargo)} ${cargoArgs.map(quote).join(" ")}`,
          ],
          { env, log },
        );
      } else await command(hostCargo, cargoArgs, { env, log });
    } finally {
      closeSync(log);
    }
  }
  const binaries = Object.fromEntries(
    LOCK.build.binaries.map((name) => {
      const path = join(target, name);
      return [name, { path, sha256: hash(readFileSync(path)) }];
    }),
  );
  const runtimeWasmPath = join(
    sourcePath,
    "target/release/wbuild/kitchensink-runtime/kitchensink_runtime.compact.compressed.wasm",
  );
  if (!existsSync(runtimeWasmPath))
    throw new Error("The built embedded runtime WASM artifact is missing.");
  const runtimeWasmBytes = readFileSync(runtimeWasmPath);
  const runtimeWasm = {
    path: runtimeWasmPath,
    sha256: hash(runtimeWasmBytes),
    codeHash: blake2AsHex(runtimeWasmBytes),
  };
  const result = {
    sourceCommit: revision,
    patchSha256: LOCK.patch.sha256,
    cargoLockSha256: LOCK.source.cargoLockSha256,
    nixpkgs: LOCK.build.nixpkgs,
    builtAt: new Date().toISOString(),
    rustVersion: execFileSync("rustc", ["--version"], {
      encoding: "utf8",
    }).trim(),
    wasmRustVersion: execFileSync(
      "rustup",
      ["run", LOCK.build.wasmToolchain, "rustc", "--version"],
      { encoding: "utf8" },
    ).trim(),
    binaries,
    runtimeWasm,
    buildHash: hash(JSON.stringify({ binaries, runtimeWasm })),
  };
  atomicJSON(artifactPath, result);
  output({ status: "BUILT", ...result });
});
