import { expect, test } from "@playwright/test";
import { acceptPrivacyNotice, shot } from "../e2e/helpers.ts";

// The deployed app serves web and API from one origin; HOSTED_API_URL is only for rehearsing on a local stack.
const API = process.env.HOSTED_API_URL ?? "";

// Signed-in journey on the deployed app. It reuses the session saved by auth.setup.ts (one sign-in for
// all signed-in journeys) and leaves the test account as it found it.
test("hosted: log water, calculate goals including vitamins and minerals, goals sync", async ({ page }, info) => {
  await page.goto("/");
  await acceptPrivacyNotice(page, info);
  await expect(page.getByRole("heading", { name: "Let's cook something", exact: true })).toBeVisible();
  await expect(page.getByTestId("catalog-status")).toContainText("USDA foods saved on this device");
  await shot(page, info, "hosted-kitchen", "Signed in on the hosted app, starter catalog on the device");

  // Water: a glass is saved on the device, then acknowledged by the server.
  await page.goto("/#/you");
  const card = page.getByTestId("water-today");
  const before = await card.getByTestId("water-drink").count();
  await card.getByTestId("water-glass").click();
  await expect(card.getByTestId("water-drink")).toHaveCount(before + 1);
  await expect(card.getByTestId("water-drink").last()).not.toContainText("Saved on this device");
  const today = new Date().toLocaleDateString("en-CA");
  expect((await (await page.request.get(`${API}/v1/water?from=${today}&to=${today}`)).json()).drinks).toHaveLength(before + 1);
  await shot(page, info, "hosted-water", "Water today on the hosted app");

  // Calculator, with opt-in vitamin and mineral rows.
  await page.goto("/#/goals");
  await expect(page.getByTestId("goals-summary")).toBeVisible();
  await page.getByRole("button", { name: "Help me calculate" }).click();
  const sheet = page.getByRole("dialog", { name: "Help me calculate goals" });
  await sheet.getByRole("radio", { name: "Female", exact: true }).click();
  await sheet.getByLabel("Age").fill("40");
  await sheet.getByLabel("Height").fill("165");
  await sheet.getByLabel("Weight").fill("60");
  await sheet.getByRole("radio", { name: /Low active/ }).check();
  await sheet.getByRole("button", { name: "Show suggestions" }).click();
  const results = sheet.getByTestId("calc-results");
  const row = (n: string) => results.locator(`[data-nutrient="${n}"]`);
  await expect(row("iron").getByLabel("Iron, at least")).toHaveValue("18");
  await expect(row("sodium").getByLabel("Sodium, no more than")).toHaveValue("2300");
  await shot(page, info, "hosted-calc", "Calculator on the hosted app with vitamins and minerals");
  await row("iron").getByRole("checkbox").check();
  await row("water").getByRole("checkbox").uncheck();
  for (const k of ["energy_kcal", "protein", "fat_total", "carbohydrate", "fiber"]) await row(k).getByRole("checkbox").uncheck();
  await sheet.getByRole("button", { name: "Save 1 goal" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => ((await (await page.request.get(`${API}/v1/goals`)).json()).goals as { nutrientKey: string }[]).map((g) => g.nutrientKey)).toEqual(["iron"]);
  await shot(page, info, "hosted-goal-saved", "Iron goal saved and synced");

  // Leave the account as found: remove the glass and the goal through the app.
  await page.goto("/#/you");
  await page.getByTestId("water-today").getByTestId("water-drink").last().getByRole("button", { name: /^Remove/ }).click();
  await expect(page.getByTestId("water-today").getByTestId("water-drink")).toHaveCount(before);
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("goal-card").first().getByRole("button", { name: /^Edit/ }).click();
  await page.getByRole("button", { name: "Delete goal" }).click();
  await expect.poll(async () => ((await (await page.request.get(`${API}/v1/goals`)).json()).goals as { nutrientKey: string; deleted?: boolean }[]).filter((g) => !g.deleted).length).toBe(0);
});
