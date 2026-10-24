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
  cpSync,
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
  test("reset archives every generation binding while leaving another active descriptor untouched", () => {
    const auxiliary = join(root, ".agent-workspace");
    mkdirSync(auxiliary, { recursive: true });
    const fixture = mkdtempSync(join(auxiliary, "reset-fixture-"));
    const id = "reset-isolation";
    const directory = join(fixture, ".local-state", id);
    const artifacts = [
      "deployment.json",
      "seed.json",
      "workspace.json",
      "qualification.json",
      "runtime-artifacts.json",
      "native-metadata-binding.json",
      "capabilities.json",
      ".candidate-metadata-binding.json",
      "qualification-before-metadata-binding.json",
      "runtime-artifacts-before-metadata-binding.json",
      "native.log",
      "gateway.log",
    ];
    try {
      mkdirSync(join(fixture, "scripts/local"), { recursive: true });
      mkdirSync(join(fixture, "scripts/dev"), { recursive: true });
      mkdirSync(join(fixture, "infra/local"), { recursive: true });
      mkdirSync(join(fixture, "apps/web/public"), { recursive: true });
      for (const name of ["shared", "plan", "stop", "reset"])
        cpSync(
          join(root, `scripts/local/${name}.mjs`),
          join(fixture, `scripts/local/${name}.mjs`),
        );
      cpSync(
        join(root, "scripts/dev/native-artifacts.mjs"),
        join(fixture, "scripts/dev/native-artifacts.mjs"),
      );
      cpSync(
        join(root, "infra/local/runtime.lock.json"),
        join(fixture, "infra/local/runtime.lock.json"),
      );
      const invoke = (name: string, args: string[]) =>
        spawnSync(process.execPath, [`scripts/local/${name}.mjs`, ...args], {
          cwd: fixture,
          encoding: "utf8",
        });
      expect(invoke("plan", ["--run", id]).status).toBe(0);
      const descriptor = join(fixture, "apps/web/public/local-run.json");
      const otherDescriptor =
        '{"runId":"other-active-run","sentinel":"retain-exactly"}\n';
      writeFileSync(descriptor, otherDescriptor);
      const manifestPath = join(directory, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      Object.assign(manifest, {
        qualification: { status: "IDENTITY_VERIFIED" },
        capabilities: { runId: id },
        genesisHash: "old-genesis",
        buildHash: "old-build",
      });
      writeFileSync(manifestPath, JSON.stringify(manifest));
      for (const artifact of artifacts)
        writeFileSync(join(directory, artifact), `generation-one:${artifact}`);
      mkdirSync(join(directory, "probes"));
      writeFileSync(
        join(directory, "probes/release.json"),
        "retained-release-proof",
      );
      mkdirSync(join(directory, "native"));
      mkdirSync(join(directory, "gateway"));
      const result = invoke("reset", ["--run", id, "--generation", "1"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const reset = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(reset.generation).toBe(2);
      expect(reset.status).toBe("planned");
      for (const field of [
        "qualification",
        "capabilities",
        "genesisHash",
        "buildHash",
      ])
        expect(reset[field]).toBeUndefined();
      for (const artifact of artifacts) {
        expect(existsSync(join(directory, artifact))).toBe(false);
        expect(
          readFileSync(
            join(directory, "history/generation-1", artifact),
            "utf8",
          ),
        ).toBe(`generation-one:${artifact}`);
      }
      expect(
        readFileSync(
          join(directory, "history/generation-1/probes/release.json"),
          "utf8",
        ),
      ).toBe("retained-release-proof");
      expect(existsSync(join(directory, "native"))).toBe(false);
      expect(existsSync(join(directory, "gateway"))).toBe(false);
      expect(readFileSync(descriptor, "utf8")).toBe(otherDescriptor);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
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
