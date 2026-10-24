import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "@account-handoff/native-adapter";
export const ROOT = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
export const UNIT = 100_000_000_000_000n;
export const EVM_UNIT = 1_000_000_000_000_000_000n;
export const ZERO4 = "0x00000000" as Hex;
