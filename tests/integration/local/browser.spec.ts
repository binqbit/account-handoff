/** Real-native scenarios register in this order and run in one worker. */
import { test } from "@playwright/test";
import { registerBaselineScenarios } from "./scenarios/baseline";
import { registerHandoffScenarios } from "./scenarios/handoff";
import { registerSetupScenarios } from "./scenarios/setup";
import { localWalletTrace } from "./browser-wallet";

test.afterEach(async ({ page }, testInfo) => {
  const trace = localWalletTrace(page);
  if (trace)
    await testInfo.attach("local-native-wallet-audit", {
      body: JSON.stringify(trace, null, 2),
      contentType: "application/json",
    });
});

test.describe("real LOCAL website and native wallet boundary", () => {
  test.skip(
    process.env["AH_LOCAL_BROWSER"] !== "1",
    "Run explicitly with AH_LOCAL_BROWSER=1 after seeding a dedicated LOCAL baseline.",
  );
  registerBaselineScenarios();
  registerHandoffScenarios();
  registerSetupScenarios();
});
