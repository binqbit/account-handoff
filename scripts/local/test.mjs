import { join } from "node:path";
import { ROOT, main, command } from "./shared.mjs";
await main(async (args) => {
  const run = args.run ?? "development";
  for (const action of ["seed", "handoff", "negative"]) {
    await command(process.execPath, [
      "--import",
      "tsx",
      join(ROOT, "scripts/local/native-tools.ts"),
      "--run",
      run,
      "--action",
      action,
    ]);
  }
  await command(process.execPath, [
    join(ROOT, "scripts/local/capabilities.mjs"),
    "--run",
    run,
  ]);
});
