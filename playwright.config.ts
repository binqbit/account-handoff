import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const explicitBrowser = process.env["CHROME_PATH"];
if (explicitBrowser && !existsSync(explicitBrowser)) {
  throw new Error("CHROME_PATH must name an existing browser executable");
}
const executablePath =
  explicitBrowser ??
  [
    "/run/current-system/sw/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((candidate) => existsSync(candidate));
const browserPort = Number(process.env["AH_BROWSER_PORT"] ?? "4173");
if (!Number.isInteger(browserPort) || browserPort < 1024 || browserPort > 65535)
  throw new Error("AH_BROWSER_PORT must be an integer from 1024 to 65535");
const browserOrigin = `http://127.0.0.1:${browserPort}`;

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  use: {
    baseURL: browserOrigin,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  outputDir: fileURLToPath(
    new URL(".agent-workspace/verification/browser/", import.meta.url),
  ),
  webServer: {
    command: `npm run dev -- --port ${browserPort} --strictPort`,
    url: browserOrigin,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
