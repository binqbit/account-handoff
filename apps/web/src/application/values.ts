import type { VestingTuple } from "@account-handoff/contracts";

import { plain, object } from "@account-handoff/native-adapter";

export const json = <T>(value: T): T => plain(value) as T;
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const id = () => crypto.randomUUID();
export function schedules(value: unknown): VestingTuple[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("Unrecognized native vesting format");
  return value.map((item) => {
    const v = object(item);
    return {
      locked: String(v["locked"]),
      perBlock: String(v["perBlock"]),
      startingBlock: String(v["startingBlock"]),
      clockDomain: "native-block-number",
    };
  });
}
