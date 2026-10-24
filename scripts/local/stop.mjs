import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readRun,
  runDirectory,
  saveRun,
  emitDescriptor,
  output,
  until,
  main,
} from "./shared.mjs";

export async function stopRun(run) {
  for (const [name, item] of Object.entries(run.processes ?? {})) {
    let commandLine;
    try {
      commandLine = readFileSync(`/proc/${item.pid}/cmdline`, "utf8").split(
        "\0",
      );
    } catch {
      continue;
    }
    const baseIndex = commandLine.indexOf("--base-path");
    const expectedPath = join(
      runDirectory(run.runId),
      name === "native" ? "native" : "gateway",
    );
    if (
      commandLine[0] !== item.binary ||
      baseIndex < 0 ||
      commandLine[baseIndex + 1] !== expectedPath
    )
      throw new Error(`Refusing to stop an unrecognized ${name} process.`);
    process.kill(item.pid, "SIGINT");
    await until(
      `${name} shutdown`,
      async () => {
        try {
          process.kill(item.pid, 0);
          const stat = readFileSync(`/proc/${item.pid}/stat`, "utf8");
          return /\) Z /.test(stat);
        } catch {
          return true;
        }
      },
      20_000,
    );
  }
  run.processes = {};
  run.status = "stopped";
  run.stoppedAt = new Date().toISOString();
  saveRun(run);
  emitDescriptor(run);
  return run;
}
if (process.argv[1]?.endsWith("/stop.mjs"))
  await main(async (args) =>
    output({
      status: "STOPPED",
      run: await stopRun(readRun(args.run ?? "development")),
    }),
  );
