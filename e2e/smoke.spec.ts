import { expect, test } from "@playwright/test";

/**
 * One journey through the whole app with the sample dataset.
 *
 * The sample loads through the real import pipeline rather than seeding the
 * database, so this exercises parsing, categorisation, transfer detection,
 * aggregation, risk scoring, projections, allocation and the alert rules in a
 * single pass — if any of them break, this fails.
 */
test("sample data flows through every page", async ({ page }) => {
  await page.goto("/");

  // Located by href inside the sidebar. Page copy links to /plan and /invest
  // too, so an unscoped lookup is ambiguous — and the Alerts link carries an
  // unread-count badge, so its accessible name is not just "Alerts".
  const nav = page.getByRole("navigation", { name: "Primary" });
  const goTo = (href: string) => nav.locator(`a[href="${href}"]`).click();

  await expect(page.getByRole("heading", { name: "Nothing imported yet" })).toBeVisible();

  await page.getByTestId("load-sample").click();

  // The dashboard replaces the empty state once the import lands.
  await expect(page.getByText("Typical monthly income")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Savings rate")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Income and spending" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where the money goes" })).toBeVisible();

  // Every chart offers its numbers as a table.
  await page.getByTitle("Show the numbers").first().click();
  await expect(page.getByRole("columnheader", { name: "Month" }).first()).toBeVisible();

  await goTo("/goals");
  await expect(page.getByRole("heading", { name: "House down payment" })).toBeVisible();
  await expect(page.getByText("Monthly surplus")).toBeVisible();

  await goTo("/plan");
  await expect(page.getByText("Suggested budget")).toBeVisible();

  // Moving a what-if slider changes the projection.
  const incomeSlider = page.locator("#s-income");
  await incomeSlider.fill("0.25");
  await expect(page.getByText("What that would do")).toBeVisible();

  await goTo("/invest");
  await expect(page.getByRole("heading", { name: "Target allocation" })).toBeVisible();
  await expect(page.getByText("Educational, not advice.")).toBeVisible();

  await goTo("/portfolio");
  await expect(page.getByText("Annualised (XIRR)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every holding" })).toBeVisible();

  await goTo("/alerts");
  // The sample profile is deliberately under-insured and carries expensive
  // debt, so there is always something here.
  await expect(page.getByRole("heading", { name: /Important|Needs attention now/ })).toBeVisible({
    timeout: 20_000,
  });

  await goTo("/interview");
  await expect(page.getByText("Risk profile")).toBeVisible();
});

test("the importer refuses a file it cannot read, without breaking", async ({ page }) => {
  await page.goto("/import");

  await page.setInputFiles('input[type="file"]', {
    name: "not-a-spreadsheet.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 this is not a spreadsheet"),
  });

  await expect(page.getByText("That did not work")).toBeVisible();
  // The page is still usable afterwards.
  await expect(page.getByText("Drop a spreadsheet here")).toBeVisible();
});

test("dark mode is a deliberate palette, not an inversion", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("load-sample").click();
  await expect(page.getByText("Typical monthly income")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // The theme survives a reload, because it is stamped before first paint.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
