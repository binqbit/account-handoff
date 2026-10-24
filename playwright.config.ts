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

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173",
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
    command: "npm run dev -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60000,
  },
});
