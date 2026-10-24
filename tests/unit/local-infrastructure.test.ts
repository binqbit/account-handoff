import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const root = resolve(import.meta.dirname, "../..");
function cli(name: string, args: string[]) {
  return spawnSync(process.execPath, [`scripts/local/${name}.mjs`, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("LOCAL infrastructure boundaries", () => {
  test("rejects traversal and colliding ports before creating state", () => {
    for (const args of [
      ["--run", "../outside"],
      ["--run", "bad-ports", "--native-port", "9000", "--gateway-port", "9000"],
    ]) {
      const result = cli("plan", args);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).status).toBe("FAILED");
    }
    expect(existsSync(join(root, ".local-state/bad-ports/manifest.json"))).toBe(
      false,
    );
  });

  test("reset requires the exact generation and refuses a symlinked chain directory", () => {
    const id = `infra-test-${randomUUID()}`;
    const directory = join(root, ".local-state", id);
    const outside = mkdtempSync(join(tmpdir(), "ah-infra-test-"));
    try {
      expect(cli("plan", ["--run", id]).status).toBe(0);
      writeFileSync(join(outside, "retain.txt"), "outside owned state");
      mkdirSync(join(directory, "gateway"));
      symlinkSync(outside, join(directory, "native"));
      const wrongGeneration = cli("reset", ["--run", id, "--generation", "2"]);
      expect(wrongGeneration.status).toBe(1);
      const symlinkAttempt = cli("reset", ["--run", id, "--generation", "1"]);
      expect(symlinkAttempt.status).toBe(1);
      expect(JSON.parse(symlinkAttempt.stdout).message).toMatch(/symlink/i);
      expect(readFileSync(join(outside, "retain.txt"), "utf8")).toBe(
        "outside owned state",
      );
      expect(
        JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))
          .generation,
      ).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("contract compilation preserves the attributed source and emits reproducible bytecode", () => {
    execFileSync(process.execPath, ["scripts/local/compile-contract.mjs"], {
      cwd: root,
    });
    const first = readFileSync(
      join(root, "contracts/artifacts/Vestry.json"),
      "utf8",
    );
    execFileSync(process.execPath, ["scripts/local/compile-contract.mjs"], {
      cwd: root,
    });
    expect(
      readFileSync(join(root, "contracts/artifacts/Vestry.json"), "utf8"),
    ).toBe(first);
    const artifact = JSON.parse(first);
    expect(artifact.sourceSha256).toBe(
      "62e0b0f196133fedd29f354a753bb46e5a80f7c90251ccac8272182064352797",
    );
    expect(
      artifact.abi.some(
        (item: { name?: string }) => item.name === "createGrant",
      ),
    ).toBe(true);
    expect(artifact.bytecode.length).toBeGreaterThan(1000);
  });
});
