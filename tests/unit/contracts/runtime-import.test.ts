import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("loads standalone validators in native Node ESM without Vitest CommonJS shims", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'const contracts = await import("@account-handoff/contracts"); console.log(contracts.validateRecord({}).ok);',
    ],
    { cwd: process.cwd(), timeout: 15000 },
  );
  expect(stdout.trim()).toBe("false");
});
