import { expect, test } from "@playwright/test";

test("actual application starts with an empty local workspace and no signing request", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "The team changes. The grant stays.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Network disconnected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("TEST HARNESS", { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    sockets.every((url) => new URL(url).host === new URL(baseURL!).host),
  ).toBe(true);
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A guide to Account Handoff" }),
  ).toBeVisible();
});

test("actual application reports missing native wallet without substituting an account", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Install a supported native wallet",
  );
  await expect(page.getByLabel("Personal account")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request signature", exact: true }),
  ).toHaveCount(0);
});
