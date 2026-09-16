import { expect, test } from "@playwright/test";

test("pairs an iPhone through the guided browser flow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Connect your iPhone" })).toBeVisible();
  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();

  const candidate = page.getByRole("button", { name: /Nearby Apple device Possible iPhone/ });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await page.getByRole("button", { name: "Pair over Bluetooth" }).click();

  const dialog = page.getByRole("dialog", { name: "Does your iPhone show this code?" });
  await expect(dialog).toContainText("042731");
  await dialog.getByRole("button", { name: "Codes match" }).click();

  await expect(page.getByText("Pairing complete")).toBeVisible();
  await expect(page.getByText("Paired with Nick’s iPhone.")).toBeVisible();
  await expect(page.getByText("Bluetooth: connected")).toBeVisible();
});
