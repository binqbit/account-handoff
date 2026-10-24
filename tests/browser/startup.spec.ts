import { expect, test } from "@playwright/test";

test("actual application starts with an empty local workspace and no signing request", async ({
  page,
}) => {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Команда змінюється. Грант залишається.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Підключити гаманець", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Мережа не підключена", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("TEST HARNESS", { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(sockets.every((url) => new URL(url).port === "4173")).toBe(true);
  await page
    .getByRole("button", { name: "Грант і етапи", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Спочатку відкрийте робочий простір" }),
  ).toBeVisible();
});

test("actual application reports missing native wallet without substituting an account", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Підключити гаманець", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Install a supported native wallet",
  );
  await expect(page.getByLabel("Особистий акаунт")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Запросити підпис", exact: true }),
  ).toHaveCount(0);
});
