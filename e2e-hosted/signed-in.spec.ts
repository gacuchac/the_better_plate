import { expect, test } from "@playwright/test";
import { acceptPrivacyNotice, shot } from "../e2e/helpers.ts";

// Signed-in journey on the deployed app. The one-time code arrives by real email, so the person
// running this reads it from the inbox and passes HOSTED_EMAIL and HOSTED_CODE (send the code first:
// POST /v1/auth/email-otp/send-verification-otp). Skipped when they are not set.
const email = process.env.HOSTED_EMAIL;
const code = process.env.HOSTED_CODE;

test.skip(!email || !code, "set HOSTED_EMAIL and HOSTED_CODE to run signed-in journeys");

test("hosted: sign in, log water, calculate goals including vitamins and minerals, goals sync", async ({ page }, info) => {
  const signedIn = await page.request.post("/v1/auth/sign-in/email-otp", { data: { email, otp: code }, headers: { Origin: process.env.HOSTED_URL! } });
  expect(signedIn.ok(), `sign-in: ${signedIn.status()}`).toBe(true);
  await page.goto("/");
  await acceptPrivacyNotice(page, info);
  await expect(page.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();
  await expect(page.getByTestId("catalog-status")).toContainText("USDA foods saved on this device");
  await shot(page, info, "hosted-kitchen", "Signed in on the hosted app, starter catalog on the device");

  // Water: a glass is saved on the device, then acknowledged by the server.
  await page.goto("/#/you");
  const card = page.getByTestId("water-today");
  await card.getByTestId("water-glass").click();
  await expect(card.getByTestId("water-drink")).toHaveCount(1);
  await expect(card.getByTestId("water-drink")).not.toContainText("Saved on this device");
  const today = new Date().toLocaleDateString("en-CA");
  expect((await (await page.request.get(`/v1/water?from=${today}&to=${today}`)).json()).drinks).toHaveLength(1);
  await shot(page, info, "hosted-water", "Water today on the hosted app");

  // Calculator, with opt-in vitamin and mineral rows.
  await page.goto("/#/goals");
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
  await expect.poll(async () => ((await (await page.request.get("/v1/goals")).json()).goals as { nutrientKey: string }[]).map((g) => g.nutrientKey)).toEqual(["iron"]);
  await shot(page, info, "hosted-goal-saved", "Iron goal saved and synced");

  // Tidy up the test account's data (deleting the account removes everything recorded for it).
  const del = await page.request.delete("/v1/me", { headers: { Origin: process.env.HOSTED_URL! } });
  expect(del.status()).toBeLessThan(300);
});
