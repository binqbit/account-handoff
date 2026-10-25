import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const executablePath =
  process.env["CHROME_PATH"] ??
  [
    "/run/current-system/sw/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
const output = resolve(
  ".agent-workspace/implementation/testnet-pipeline/fork/browser-results",
);
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  timeout: 1800000,
  expect: { timeout: 45000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:44174",
    browserName: "chromium",
    headless: true,
    actionTimeout: 45000,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  outputDir: output,
  reporter: [["line"], ["json", { outputFile: `${output}/report.json` }]],
  webServer: {
    cwd: process.cwd(),
    command:
      "npx vite --config apps/web/vite.config.ts --mode testnet --host 127.0.0.1 --port 44174 --strictPort",
    url: "http://127.0.0.1:44174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
