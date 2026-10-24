import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const local = process.argv.includes("--local");
const commands = [
  "node",
  "npm",
  "git",
  ...(local
    ? [
        "cargo",
        "rustc",
        "rustup",
        ...(existsSync("/etc/NIXOS")
          ? ["nix"]
          : ["clang", "cmake", "pkg-config", "protoc"]),
      ]
    : []),
];
const checks = commands.map((command) => {
  try {
    return {
      command,
      version: execFileSync(command, ["--version"], { encoding: "utf8" }).split(
        "\n",
      )[0],
      ok: true,
    };
  } catch {
    return { command, ok: false };
  }
});
const [major, minor] = process.versions.node.split(".").map(Number);
const nodeSupported = major > 24 || (major === 24 && minor >= 10);
console.log(
  JSON.stringify(
    {
      nodeSupported,
      checks,
    },
    null,
    2,
  ),
);
if (checks.some((check) => !check.ok) || !nodeSupported) process.exitCode = 1;
