import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;

test("unchecked signing and sending buttons cannot dispatch an operation", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page
    .getByRole("button", { name: "Prepare for review", exact: true })
    .click();
  const acknowledgement = page.getByRole("checkbox");
  const sign = page.getByRole("button", {
    name: "Request signature",
    exact: true,
  });
  const commands = () =>
    page.evaluate(() =>
      (
        window as unknown as { __uiTest: { commands: { type: string }[] } }
      ).__uiTest.commands.map((command) => command.type),
    );

  await expect(acknowledgement).not.toBeChecked();
  await expect(sign).toBeDisabled();
  await sign.click({ force: true });
  await sign.evaluate((button) => (button as HTMLButtonElement).click());
  expect(await commands()).toEqual(["prepare-operation"]);

  await acknowledgement.check();
  await expect(sign).toBeEnabled();
  await sign.click();
  const send = page.getByRole("button", {
    name: "Send signed operation",
    exact: true,
  });
  await expect(acknowledgement).not.toBeChecked();
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  await send.evaluate((button) => (button as HTMLButtonElement).click());
  expect(await commands()).toEqual(["prepare-operation", "sign-operation"]);

  await acknowledgement.check();
  await expect(send).toBeEnabled();
  await send.click();
  expect(await commands()).toEqual([
    "prepare-operation",
    "sign-operation",
    "send-operation",
  ]);
});
