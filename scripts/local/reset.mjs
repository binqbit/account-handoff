import {
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  renameSync,
  readFileSync,
  mkdirSync,
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

function existsWithoutFollowingLinks(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

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
  const artifacts = [
    "deployment.json",
    "seed.json",
    "workspace.json",
    "qualification.json",
    "runtime-artifacts.json",
    "native-metadata-binding.json",
    "capabilities.json",
    ".candidate-metadata-binding.json",
    ".native-operation.lock.json",
    "qualification-before-metadata-binding.json",
    "runtime-artifacts-before-metadata-binding.json",
    "probes",
    "native.log",
    "gateway.log",
  ].map((name) => join(directory, name));
  const history = join(directory, "history");
  const archive = join(history, `generation-${run.generation}`);
  if (existsWithoutFollowingLinks(archive))
    throw new Error(
      "This generation already has a history archive; reconcile the interrupted reset first.",
    );
  for (const target of [...targets, ...artifacts, history])
    if (
      existsWithoutFollowingLinks(target) &&
      (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target)
    )
      throw new Error("Reset refuses symlinked state paths.");
  await stopRun(run);
  atomicJSON(join(directory, `retired-generation-${run.generation}.json`), run);
  mkdirSync(archive, { recursive: true });
  for (const artifact of artifacts)
    if (existsSync(artifact))
      renameSync(artifact, join(archive, artifact.slice(directory.length + 1)));
  for (const target of targets)
    rmSync(target, { recursive: true, force: true });
  run.generation++;
  run.status = "planned";
  run.namespace = `account-handoff:local:${run.runId}:${run.generation}`;
  run.processes = {};
  delete run.qualification;
  delete run.capabilities;
  delete run.genesisHash;
  delete run.buildHash;
  delete run.lastStartedAt;
  delete run.stoppedAt;
  // Every generation-bound qualification and receipt remains inspectable in its archive.
  run.previousGenerationRetired = true;
  run.resetAt = new Date().toISOString();
  saveRun(run);
  emitDescriptor(run);
  output({
    status: "RESET",
    run,
    preserved: ["browser records", `history/generation-${run.generation - 1}`],
    next: "local:up then local:qualify; old generation records are inspect-only",
  });
});
