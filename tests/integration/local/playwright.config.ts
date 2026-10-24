import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const explicitBrowser = process.env["CHROME_PATH"];
if (explicitBrowser && !existsSync(explicitBrowser))
  throw new Error("CHROME_PATH must name an existing browser executable");
const executablePath =
  explicitBrowser ??
  [
    "/run/current-system/sw/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((candidate) => existsSync(candidate));
const outputDirectory = fileURLToPath(
  new URL(
    "../../../.agent-workspace/verification/local-browser/current",
    import.meta.url,
  ),
);
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  timeout: 900000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    headless: true,
    actionTimeout: 45000,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  outputDir: outputDirectory,
  reporter: [
    ["line"],
    ["json", { outputFile: `${outputDirectory}/report.json` }],
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
