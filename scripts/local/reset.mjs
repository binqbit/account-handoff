import {
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  renameSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  readRun,
  runDirectory,
  saveRun,
  emitDescriptor,
  output,
  main,
  atomicJSON,
} from "./shared.mjs";
import { stopRun } from "./stop.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  if (String(args.generation ?? "") !== String(run.generation))
    throw new Error(
      `Reset requires --generation ${run.generation}; inspect local:status first.`,
    );
  const directory = runDirectory(run.runId);
  const operationLock = join(directory, ".native-operation.lock.json");
  if (existsSync(operationLock)) {
    const owner = JSON.parse(readFileSync(operationLock, "utf8"));
    let active = true;
    try {
      process.kill(owner.pid, 0);
    } catch {
      active = false;
    }
    if (active)
      throw new Error(
        "An active native operation owns this run; finish or stop that operator before reset.",
      );
  }
  const targets = ["native", "gateway"].map((name) => join(directory, name));
  for (const target of targets)
    if (
      existsSync(target) &&
      (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target)
    )
      throw new Error("Reset refuses symlinked state paths.");
  await stopRun(run);
  atomicJSON(join(directory, `retired-generation-${run.generation}.json`), run);
  for (const target of targets)
    rmSync(target, { recursive: true, force: true });
  for (const name of ["deployment", "seed"]) {
    const current = join(directory, `${name}.json`);
    if (existsSync(current))
      renameSync(
        current,
        join(directory, `${name}-generation-${run.generation}.json`),
      );
  }
  run.generation++;
  run.status = "planned";
  run.namespace = `account-handoff:local:${run.runId}:${run.generation}`;
  run.processes = {};
  delete run.qualification;
  delete run.genesisHash;
  // Retained deployment/seed evidence identifies its old generation and is never reused automatically.
  run.previousGenerationRetired = true;
  run.resetAt = new Date().toISOString();
  saveRun(run);
  emitDescriptor(run);
  output({
    status: "RESET",
    run,
    preserved: ["browser records", "deployment and seed evidence", "logs"],
    next: "local:up then local:qualify; old generation records are inspect-only",
  });
});
