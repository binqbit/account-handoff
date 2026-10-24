import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(
  ".agent-workspace/verification",
  `testnet-server-${randomUUID()}`,
);
let server: Server;
let origin: string;
beforeAll(async () => {
  const moduleUrl = pathToFileURL(resolve("infra/testnet/serve.mjs")).href;
  const { createStaticServer } = (await import(moduleUrl)) as {
    createStaticServer(directory: string): Promise<Server>;
  };
  await mkdir(resolve(directory, "www/assets"), { recursive: true });
  await writeFile(
    resolve(directory, "www/index.html"),
    "<!doctype html><title>App</title>",
  );
  await writeFile(
    resolve(directory, "www/assets/app-hash.js"),
    "export const ready = true;",
  );
  await writeFile(resolve(directory, "private.js"), "outside the static root");
  await symlink(
    resolve(directory, "private.js"),
    resolve(directory, "www/assets/escape.js"),
  );
  await writeFile(resolve(directory, "www/assets/.hidden.js"), "hidden");
  server = await createStaticServer(resolve(directory, "www"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});

describe("standalone testnet static server", () => {
  it("serves the entry point without caching and hashed assets with their exact MIME type", async () => {
    const index = await fetch(origin);
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect(index.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await index.text()).toContain("<title>App</title>");
    const asset = await fetch(`${origin}/assets/app-hash.js?version=1`);
    expect(asset.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toContain("export const ready");
    const head = await fetch(origin, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe(
      index.headers.get("content-length"),
    );
    expect(await head.text()).toBe("");
  });

  it("does not serve package metadata, hidden files, traversal paths or symlinks outside www", async () => {
    for (const path of [
      "/network.json",
      "/.env",
      "/assets/.hidden.js",
      "/assets/escape.js",
      "/assets/%2e%2e%2fprivate.js",
      "/assets/missing.js",
    ])
      expect((await fetch(origin + path)).status, path).toBe(404);
    expect((await fetch(`${origin}/assets/%ZZ`)).status).toBe(400);
  });

  it("rejects writes instead of accepting requests that cannot be persisted", async () => {
    const response = await fetch(origin, { method: "POST", body: "test" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
