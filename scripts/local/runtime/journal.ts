import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  fsyncSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { requireCondition } from "./guards.js";
export function save(path: string, value: unknown) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify(
      value,
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      2,
    ) + "\n",
    { mode: 0o600, flush: true },
  );
  renameSync(temporary, path);
  const directory = openSync(resolve(path, ".."), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function acquireRunLock(directory: string, action: string): () => void {
  const path = join(directory, ".native-operation.lock.json");
  const token = randomUUID();
  if (existsSync(path)) {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch {
      alive = false;
    }
    requireCondition(
      !alive && action === "reconcile",
      "Another LOCAL operation owns this run, or a crashed run requires local:reconcile first",
    );
    unlinkSync(path);
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token, action }));
  } finally {
    closeSync(fd);
  }
  return () => {
    if (
      existsSync(path) &&
      (JSON.parse(readFileSync(path, "utf8")) as { token: string }).token ===
        token
    )
      unlinkSync(path);
  };
}
