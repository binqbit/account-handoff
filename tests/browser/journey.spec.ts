import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs${resolve("tests/browser/fixtures/ui.html")}`;
test("four destinations retain the same beneficiary and separate operation stages", async ({
  page,
}) => {
  await page.goto(harness);
  await expect(
    page.getByRole("heading", { name: "Atlas Research", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Грант і етапи", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Продовжуйте роботу над тим самим грантом",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Наступний результат" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Команда", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Люди змінюються. Бенефіціар — той самий.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Передати керування", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Три дії. Один сталий бенефіціар." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Перевірити наступну дію" }).click();
  await page.getByRole("button", { name: "Підготувати до перегляду" }).click();
  const sign = page.getByRole("button", { name: "Запросити підпис" });
  await expect(sign).toBeDisabled();
  await expect(
    page.getByText("M0 залишається авторизованою.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await sign.click();
  const send = page.getByRole("button", {
    name: "Надіслати підписану операцію",
  });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox").check();
  await send.click();
  await expect(
    page.getByRole("button", { name: "Запросити підпис" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Звірити результат", exact: true }),
  ).toBeVisible();
  const commands = await page.evaluate(() =>
    (
      window as unknown as { __uiTest: { commands: { type: string }[] } }
    ).__uiTest.commands.map((command) => command.type),
  );
  expect(commands).toEqual([
    "prepare-operation",
    "sign-operation",
    "send-operation",
  ]);
});
test("changing the account invalidates review without prompting or sending", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-ROTATION-ADD-M1`);
  await page.getByRole("button", { name: "Підготувати до перегляду" }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Особистий акаунт").selectOption({ label: "Богдан" });
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Запросити підпис" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Змінено акаунт. Потрібен новий перегляд."),
  ).toBeVisible();
  const types = await page.evaluate(() =>
    (
      window as unknown as { __uiTest: { commands: { type: string }[] } }
    ).__uiTest.commands.map((command) => command.type),
  );
  expect(types).toEqual(["prepare-operation", "select-account"]);
});
test("UTF-8 evidence limit blocks preparation and retains text", async ({
  page,
}) => {
  await page.goto(`${harness}#review?action=GRC-GRANT-SUBMIT-M1`);
  const evidence = page.getByLabel("Публічний доказ");
  await evidence.fill("ї".repeat(513));
  await page.getByRole("button", { name: "Підготувати до перегляду" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "перевищує 1024 UTF-8 байт",
  );
  await expect(evidence).toHaveValue("ї".repeat(513));
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __uiTest: { commands: unknown[] } }).__uiTest
          .commands.length,
    ),
  ).toBe(0);
});
test("empty workspace exposes setup and actual network configuration without a fake success", async ({
  page,
}) => {
  await page.goto(`${harness}?scenario=empty`);
  await expect(
    page.getByRole("heading", {
      name: "Команда змінюється. Грант залишається.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Створити простір", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Почніть зі сталого бенефіціара" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Початкова група M0 — три адреси"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Зберегти команду" }),
  ).toBeDisabled();
});
