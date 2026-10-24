/** Explicit LOCAL-only CLI. Never imported by the browser bundle. */
import { runLocalOperator } from "./runtime/operator.js";

runLocalOperator(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
