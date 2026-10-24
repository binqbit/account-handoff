import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export async function createStaticServer(directory) {
  const root = await realpath(directory);
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    const reject = (status, message) => {
      response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : message);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      reject(405, "Method not allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
    } catch {
      reject(400, "Invalid path");
      return;
    }
    if (
      pathname.includes("\\") ||
      pathname.includes("\0") ||
      pathname.split("/").some((part) => part.startsWith(".")) ||
      !(
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname.startsWith("/assets/")
      )
    ) {
      reject(404, "Not found");
      return;
    }
    try {
      const file = await realpath(
        resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`),
      );
      const pathFromRoot = relative(root, file);
      const info = await stat(file);
      if (
        pathFromRoot.startsWith("..") ||
        isAbsolute(pathFromRoot) ||
        !info.isFile() ||
        !types[extname(file)]
      ) {
        reject(404, "Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[extname(file)],
        "Content-Length": info.size,
        "Cache-Control":
          extname(file) === ".html"
            ? "no-store"
            : "public, max-age=31536000, immutable",
      });
      if (request.method === "HEAD") response.end();
      else {
        const stream = createReadStream(file);
        stream.on("error", () => response.destroy());
        stream.pipe(response);
      }
    } catch (error) {
      reject(error.code === "ENOENT" ? 404 : 500, "File unavailable");
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.AH_HOST || "127.0.0.1";
  const port = Number(process.env.AH_PORT || "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("AH_PORT must be an integer between 1 and 65535.");
  const server = await createStaticServer(
    resolve(dirname(fileURLToPath(import.meta.url)), "www"),
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Account Handoff testnet: http://${host}:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
