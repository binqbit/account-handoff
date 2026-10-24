import { join } from "node:path";
import { ROOT, main, command } from "./shared.mjs";
await main(async (args) => {
  await command(process.execPath, [
    "--import",
    "tsx",
    join(ROOT, "scripts/local/native-tools.ts"),
    "--run",
    args.run ?? "development",
    "--action",
    "seed",
  ]);
  await command(process.execPath, [
    join(ROOT, "scripts/local/capabilities.mjs"),
    "--run",
    args.run ?? "development",
  ]);
});
