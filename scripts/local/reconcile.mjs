import { join } from "node:path";
import { ROOT, main, command } from "./shared.mjs";
await main(async (args) =>
  command(process.execPath, [
    "--import",
    "tsx",
    join(ROOT, "scripts/local/native-tools.ts"),
    "--run",
    args.run ?? "development",
    "--action",
    "reconcile",
  ]),
);
