import { expect, test } from "@playwright/test";
import { shot } from "../e2e/helpers.ts";

// The redesigned screens on the deployed app, signed in through the session saved by auth.setup.ts.
// Read-only: nothing here changes the test account's data (Gentle mode is turned on and off again).

test("hosted: redesigned screens, signed in", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByTestId("catalog-status")).toContainText("USDA foods saved on this device");

  // Nav: Create is the raised button in the middle.
  const labels = (await page.getByRole("navigation", { name: "Main" }).locator(".nav-item").allInnerTexts()).map((l) => l.trim());
  expect(labels).toEqual(["Kitchen", "Explore", "Create", "Groups", "You"]);
  await expect(page.locator(".nav-create")).toBeVisible();

  // Today: the cook row, then the trail.
  // With nothing planned the headline itself is "Let's cook something"; otherwise it is a row above the trail.
  await expect(page.getByTestId("cook-row").or(page.getByRole("heading", { name: "Let's cook something" }))).toBeVisible();
  await shot(page, info, "hosted-today", "Today: Let's cook something row and the trail");

  await page.goto("/#/explore");
  await expect(page.getByRole("heading", { name: "Foods", exact: true })).toBeVisible();
  await shot(page, info, "hosted-explore", "Explore");

  await page.goto("/#/meals");
  await expect(page.getByRole("navigation", { name: "Week" })).toBeVisible();
  await shot(page, info, "hosted-meal-plan", "Meal plan with the week strip");

  await page.goto("/#/shopping");
  await expect(page.getByTestId("catalog-status").or(page.getByRole("heading", { name: "Shopping list" }))).toBeVisible();
  await shot(page, info, "hosted-shopping", "Shopping list");

  // You: profile header, goals inline, settings rows.
  await page.goto("/#/you");
  await expect(page.getByTestId("profile-card")).toBeVisible();
  await expect(page.getByTestId("goals-summary")).toBeVisible();
  await expect(page.getByTestId("storage-info")).toBeVisible();
  await shot(page, info, "hosted-you", "You: profile header, Goals inline, settings rows");

  // The old goals link opens You at Goals.
  await page.goto("/#/goals");
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();

  // Gentle mode on, then off again.
  const gentle = page.getByLabel(/Gentle mode/);
  await gentle.check();
  await shot(page, info, "hosted-gentle-on", "Gentle mode on");
  await gentle.uncheck();
});
