import { expect, type Page } from "@playwright/test";
export async function selectWalletAccount(page: Page, address: string) {
  const picker = page.getByRole("combobox", {
    name: "Personal account",
    exact: true,
  });
  await picker.click();
  await page
    .getByRole("listbox", { name: "Wallet accounts", exact: true })
    .locator(`[data-address="${address}"]`)
    .click();
  await expect(picker).toHaveAttribute("data-selected-address", address);
}
