import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addIngredient, API, expectSynced, newEmail, saveAndSync, shot, signIn, waitForServiceWorker } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";
const BROCCOLI = "Broccoli, raw";
const OIL = "Oil, olive, salad or cooking";

test("create a recipe with live nutrition, sources and oil handling, then sync", async ({ page }, info) => {
  await signIn(page, newEmail("create"), info);
  await shot(page, info, "kitchen-empty", "Empty kitchen with starter catalog installed indicator");

  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Lemon rice with broccoli");
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await addIngredient(page, "rice white cooked", RICE);
  const rice = page.getByTestId("ingredient-row").filter({ hasText: RICE });
  await rice.getByLabel("Unit").selectOption("g");
  await rice.getByLabel("Amount").fill("300");
  await addIngredient(page, "broccoli raw", BROCCOLI);
  const broc = page.getByTestId("ingredient-row").filter({ hasText: BROCCOLI });
  await broc.getByLabel("Unit").selectOption("g");
  await broc.getByLabel("Amount").fill("150");
  await addIngredient(page, "olive", OIL);
  const oil = page.getByTestId("ingredient-row").filter({ hasText: OIL });
  await expect(oil.getByLabel("Cooking oil (some may be left in the pan)")).toBeChecked();

  // Unmeasured oil is fully counted and disclosed.
  await expect(page.getByTestId("disclosures")).toContainText("counted as eaten");
  await expect(page.getByTestId("nutrient-energy_kcal")).toContainText("kcal");
  await shot(page, info, "editor-oil-not-measured", "Live estimate with disclosure: all oil counted");

  const energyBefore = await page.getByTestId("nutrient-energy_kcal").textContent();
  await oil.getByLabel("Oil discarded after cooking, if measured (g)").fill("4");
  await expect(page.getByTestId("disclosures")).toHaveCount(0);
  await expect(page.getByTestId("nutrient-energy_kcal")).not.toHaveText(energyBefore!);

  // Vitamins: a nutrient that some foods do not report is never shown as zero.
  await page.getByRole("button", { name: "Show vitamins and minerals" }).click();
  await shot(page, info, "editor-all-nutrients", "All tracked nutrients; partial values marked 'at least'");

  await page.getByRole("button", { name: "Energy: sources" }).click();
  const sources = page.getByTestId("source-list");
  await expect(sources).toContainText(RICE);
  await expect(sources.getByRole("link").first()).toHaveAttribute("href", /fdc\.nal\.usda\.gov\/food-details\/\d+\/nutrients/);
  await shot(page, info, "sources-drawer", "Per-ingredient provenance with USDA FDC links and retrieval date");
  await page.getByRole("button", { name: "Close" }).click();

  await saveAndSync(page);
  await shot(page, info, "editor-synced", "Saved and acknowledged by the server: Synced");

  // Browser estimate and server revalidation agree.
  const shownPerServing = (await page.getByTestId("nutrient-energy_kcal").locator(".nutrient-value").textContent())!;
  const { recipes } = await (await page.request.get(`${API}/v1/recipes`)).json();
  const saved = recipes.find((r: { title: string }) => r.title === "Lemon rice with broccoli");
  expect(saved.version).toBe(1);
  const serverKcal = saved.nutrition.perServing.find((t: { key: string }) => t.key === "energy_kcal").amount as number;
  expect(shownPerServing).toBe(`${serverKcal.toFixed(0)} kcal`);
  expect(saved.nutrition.disclosures).toEqual([]);

  await page.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(page.getByTestId("recipe-card")).toContainText("Lemon rice with broccoli");
  await expect(page.getByTestId("recipe-card")).toContainText("Synced");
  await shot(page, info, "kitchen-with-recipe", "Kitchen list with synced recipe");
});

test("edit offline after a reload, then sync when back online", async ({ page, context }, info) => {
  await signIn(page, newEmail("offline"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Broccoli snack");
  await addIngredient(page, "broccoli raw", BROCCOLI);
  await saveAndSync(page);
  const recipeUrl = page.url();
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Broccoli snack");
  await expect(page.getByTestId("sync-status")).toContainText("Offline");
  await shot(page, info, "offline-reload", "Reloaded with no network: app shell, recipe and catalog from this device");

  await page.getByLabel("Recipe name").fill("Broccoli snack, extra garlic");
  await addIngredient(page, "garlic", "Garlic, raw");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Offline · Saved on this device");
  await expect(page.getByTestId("save-message")).toContainText("sync when you're online");
  await shot(page, info, "offline-saved", "Offline save: honest 'Saved on this device', no sync claim");

  await context.setOffline(false);
  await expectSynced(page);
  await shot(page, info, "back-online-synced", "Reconnected: queued change synced");
  const { recipes } = await (await page.request.get(`${API}/v1/recipes`)).json();
  expect(recipes[0]).toMatchObject({ title: "Broccoli snack, extra garlic", version: 2 });
  expect(recipes[0].ingredients).toHaveLength(2);
  expect(page.url()).toBe(recipeUrl);
});

test("accounts are isolated on a shared device and on the server", async ({ page }, info) => {
  await signIn(page, newEmail("alice"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Alice's private stew");
  await saveAndSync(page);
  const { recipes } = await (await page.request.get(`${API}/v1/recipes`)).json();
  const aliceRecipeId = recipes[0].id as string;

  await page.getByRole("link", { name: "You", exact: true }).click();
  // Data portability: everything in the account, as a JSON file.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all my data" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^better-plate-export-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(exported.format).toBe("betterplate.export/1");
  expect(exported.recipes.map((r: { title: string }) => r.title)).toEqual(["Alice's private stew"]);
  await shot(page, info, "you-screen", "You: download all my data, export unsynced, sign out, delete account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Cook what you love, know what's in it" })).toBeVisible();
  const leftover = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(leftover.filter((n) => n?.startsWith("betterplate-user-"))).toEqual([]);

  await signIn(page, newEmail("bob"));
  await expect(page.getByRole("heading", { name: "No recipes yet" })).toBeVisible();
  await expect(page.getByText("Alice's private stew")).toHaveCount(0);
  await shot(page, info, "second-account-empty", "Different account on the same browser sees none of the first account's data");
  expect((await page.request.get(`${API}/v1/recipes/${aliceRecipeId}`)).status()).toBe(404);
});

test("conflicting edits from two devices ask before overwriting", async ({ browser }, info) => {
  const email = newEmail("twodevices");
  const phone = await browser.newContext();
  const laptop = await browser.newContext();
  const p = await phone.newPage();
  const l = await laptop.newPage();

  await signIn(p, email);
  await p.getByRole("button", { name: "New recipe" }).click();
  await p.getByLabel("Recipe name").fill("Shared pasta");
  await saveAndSync(p);
  const url = new URL(p.url());

  await signIn(l, email);
  await expect(l.getByTestId("recipe-card")).toContainText("Shared pasta");
  await l.goto(`/${url.hash}`);
  await expect(l.getByLabel("Recipe name")).toHaveValue("Shared pasta");

  await laptop.setOffline(true);
  await l.getByLabel("Recipe name").fill("Shared pasta (laptop)");
  await l.getByRole("button", { name: "Save recipe" }).click();

  await p.getByLabel("Recipe name").fill("Shared pasta (phone)");
  await saveAndSync(p);

  await laptop.setOffline(false);
  await expect(l.getByTestId("conflict-banner")).toBeVisible({ timeout: 15_000 });
  await expect(l.getByTestId("sync-status")).toHaveText("Needs attention");
  await expect(l.getByTestId("conflict-banner")).toContainText('"Shared pasta (phone)"');
  await shot(l, info, "conflict-banner", "Conflict: keep this device's, keep cloud copy, or keep both");

  await l.getByRole("button", { name: "Keep both" }).click();
  await expectSynced(l);
  await l.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(l.getByTestId("recipe-card")).toHaveCount(2);
  await shot(l, info, "conflict-kept-both", "Both versions kept as separate recipes");
  const { recipes } = await (await l.request.get(`${API}/v1/recipes`)).json();
  expect(recipes.map((r: { title: string }) => r.title).sort()).toEqual(["Shared pasta (laptop) (this device)", "Shared pasta (phone)"]);

  await phone.close();
  await laptop.close();
});

test("explore foods with per-100 g values and provenance", async ({ page }, info) => {
  await signIn(page, newEmail("explore"));
  await page.getByRole("link", { name: "Explore" }).click();
  await page.getByLabel("Search foods").fill("dragonfruit");
  await expect(page.getByTestId("not-in-catalog")).toContainText("isn't in our list yet");
  await shot(page, info, "explore-not-in-catalog", "No match: honest note, no estimated nutrients");
  // Words in any order and plurals, across all of USDA SR Legacy on the device.
  await page.getByLabel("Search foods").fill("steaks sirloin");
  await expect(page.getByRole("button", { name: /^Beef, top sirloin, steak/ }).first()).toBeVisible();
  await shot(page, info, "explore-search-steak", "Search: \"steaks sirloin\" finds USDA sirloin steak cuts");
  await page.getByLabel("Search foods").fill("salmon");
  await page.getByRole("button", { name: /Fish, salmon, Atlantic, farmed, raw/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Per 100 g, as published by USDA");
  await expect(dialog.getByRole("link")).toHaveAttribute("href", /fdc\.nal\.usda\.gov/);
  await shot(page, info, "explore-food-detail", "Food detail: USDA values per 100 g, not-reported shown as such, source link");
});

test("Continue with Google sends you to Google with this app's callback", async ({ page }, info) => {
  let googleUrl: URL | null = null;
  await page.route("https://accounts.google.com/**", async (route) => {
    googleUrl = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Google (stub)</h1>" });
  });
  await page.goto("/");
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeVisible();
  await shot(page, info, "sign-in-with-google", "Sign-in: Continue with Google, or an email code");
  await google.click();
  await expect(page.getByRole("heading", { name: "Google (stub)" })).toBeVisible();
  expect(googleUrl!.searchParams.get("client_id")).toBe("e2e-client.apps.googleusercontent.com");
  expect(googleUrl!.searchParams.get("redirect_uri")).toBe(`${API}/v1/auth/callback/google`);

  // A failed or cancelled Google sign-in comes back with a marker and an honest message.
  await page.goto("/?signin=google_failed");
  await expect(page.getByRole("alert")).toContainText("Google sign-in didn't finish");
  expect(new URL(page.url()).search).toBe("");
});

test("plan a meal, mark it eaten, and see plans kept apart from what was eaten", async ({ page, context }, info) => {
  await signIn(page, newEmail("meals"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Lemon rice");
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await addIngredient(page, "rice white cooked", RICE);
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Unit").selectOption("g");
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Amount").fill("300");
  await addIngredient(page, "broccoli raw", BROCCOLI);
  await saveAndSync(page);
  await shot(page, info, "recipe-actions", "Saved recipe: Plan, I ate this and Cook in the action bar");

  await page.getByRole("button", { name: "Plan" }).click();
  const plan = page.getByRole("dialog", { name: "Plan this meal" });
  await plan.getByRole("button", { name: "Dinner" }).click();
  await shot(page, info, "plan-sheet", "Plan sheet: day, meal and servings; plans never count as eaten");
  await plan.getByRole("button", { name: "Add to plan" }).click();
  await expect(plan).toBeHidden();

  await page.getByRole("button", { name: "I ate this" }).click();
  const eat = page.getByRole("dialog", { name: "I ate this" });
  await eat.getByRole("button", { name: "Lunch" }).click();
  await shot(page, info, "log-sheet", "I ate this: day, meal and servings eaten");
  await eat.getByRole("button", { name: "Save as eaten" }).click();
  await expect(eat).toBeHidden();
  await expectSynced(page);

  await page.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(page.getByTestId("today-card")).toContainText("Planned1 meal");
  await expect(page.getByTestId("today-card")).toContainText("Eaten1 meal");
  await shot(page, info, "kitchen-today", "Home: today's planned and eaten counts, recipe list");

  await page.getByTestId("today-card").click();
  await expect(page.getByTestId("eaten-row")).toHaveCount(1);
  await expect(page.getByTestId("planned-row")).toContainText("Lemon rice");
  await expect(page.getByTestId("eaten-card")).toContainText("Day in progress");

  // The day total is the server's frozen snapshot for the one eaten meal, not the plan.
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const meals = await (await page.request.get(`${API}/v1/meals?from=${today}&to=${today}`)).json();
  expect(meals.eaten).toHaveLength(1);
  expect(meals.planned).toHaveLength(1);
  const kcal = meals.eaten[0].eaten.find((t: { key: string }) => t.key === "energy_kcal").amount as number;
  await expect(page.getByTestId("day-totals")).toContainText(String(Math.round(kcal)));
  await shot(page, info, "meals-day", "Day view: eaten with estimated totals, plan shown separately");

  await page.getByTestId("planned-row").getByRole("button", { name: "I ate this" }).click();
  await page.getByRole("dialog", { name: "I ate this" }).getByRole("button", { name: "Save as eaten" }).click();
  await expect(page.getByTestId("planned-row")).toContainText("Eaten");
  await expect(page.getByTestId("eaten-row")).toHaveCount(2);

  await page.getByTestId("day-totals").click();
  await expect(page.getByRole("dialog")).toContainText("Plans are not included");
  // Grams only until the person sets their own goals; label Daily Values are cited, not applied.
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("FDA Daily Values");
  await expect(sheet).toContainText("Set your own daily goals to see percentages");
  await expect(sheet).not.toContainText("%");
  await shot(page, info, "meals-day-nutrients", "Day nutrients in grams, no percentages until goals are set");
  await sheet.getByRole("link", { name: "Set goals" }).click();
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dietary Guidelines for Americans, 2025–2030" })).toHaveAttribute("href", "https://realfood.gov");
  await expect(page.getByText("No goals yet")).toBeVisible();
  await page.getByRole("button", { name: "Add a goal" }).click();
  const goalSheet = page.getByRole("dialog", { name: "New goal" });
  await goalSheet.getByLabel("Nutrient").selectOption("protein");
  await goalSheet.getByLabel("Amount").fill("-3");
  await goalSheet.getByRole("button", { name: "Save goal" }).click();
  await expect(goalSheet.getByRole("alert")).toContainText("above zero");
  await goalSheet.getByLabel("Amount").fill("155");
  await shot(page, info, "goal-sheet", "New goal: nutrient, at least/at most/between, per day/week/month, dates");
  await goalSheet.getByRole("button", { name: "Save goal" }).click();
  await expect(goalSheet).toBeHidden();
  const goalCard = page.getByTestId("goal-card");
  await expect(goalCard).toContainText("At least 155 g a day");
  await expect(goalCard.getByTestId("goal-status")).toContainText("Today:");
  await expect(goalCard.getByTestId("goal-status")).toContainText("under your goal so far");
  await expectSynced(page);
  const goals = await (await page.request.get(`${API}/v1/goals`)).json();
  expect(goals.goals).toHaveLength(1);
  expect(goals.goals[0]).toMatchObject({ nutrientKey: "protein", kind: "at_least", min: 155, period: "day", startDate: today, endDate: null });
  await shot(page, info, "goals", "The person's own goal with today's progress, synced to the account");
  await page.goBack();
  await page.getByTestId("day-totals").click();
  const proteinRow = page.getByTestId("day-nutrient-protein");
  await expect(proteinRow).toContainText("of your daily goal");
  const grams = Number((await proteinRow.textContent())!.match(/([\d.]+) g/)![1]);
  await expect(proteinRow).toContainText(`${Math.round((grams / 155) * 100)}% of your daily goal`);
  await expect(page.getByTestId("day-nutrient-fiber")).not.toContainText("%");
  await expect(page.getByRole("dialog")).toContainText("Percentages compare with the daily goals you set");
  await shot(page, info, "meals-day-targets", "Protein as a share of the person's own daily goal; others stay in grams");
  await page.getByRole("button", { name: "Close" }).click();

  // Offline: a new log is saved on this device, then synced.
  await context.setOffline(true);
  await page.getByRole("button", { name: /Remove Lemon rice from eaten/ }).first().click();
  await expect(page.getByTestId("eaten-row")).toHaveCount(1);
  await expect(page.getByTestId("sync-status")).toContainText("Saved on this device");
  await context.setOffline(false);
  await expectSynced(page);
  const after = await (await page.request.get(`${API}/v1/meals?from=${today}&to=${today}`)).json();
  expect(after.eaten).toHaveLength(1);

  await page.getByRole("tab", { name: "7 days" }).click();
  await expect(page.getByTestId("week-day")).toHaveCount(7);
  await expect(page.getByTestId("week-summary")).toContainText("1 of 7 days");
  await shot(page, info, "meals-week", "7 days: logged days only, nothing-logged days never shown as zero");

  // Totals over a period on the You page: logs only, averaged per logged day.
  await page.goto("/#/you");
  const totals = page.getByTestId("period-totals");
  await expect(totals.getByTestId("totals-days")).toContainText("Meals logged on 1 of 7 days. Totals cover only those days.");
  await expect(page.getByTestId("goals-summary")).toContainText("1 active");
  const kcalRow = totals.getByRole("row", { name: /Energy/ });
  await expect(kcalRow).toContainText(String(Math.round(kcal)));
  await totals.getByRole("tab", { name: "This month" }).click();
  await expect(totals.getByTestId("totals-days")).toContainText("Meals logged on 1 of");
  await totals.getByRole("tab", { name: "Dates" }).click();
  await totals.getByLabel("From").fill(today);
  await totals.getByLabel("To").fill(today);
  await expect(totals.getByTestId("totals-days")).toHaveText("Meals logged on 1 of 1 day.");
  const summary = await (await page.request.get(`${API}/v1/nutrition/summary?from=${today}&to=${today}`)).json();
  expect(summary).toMatchObject({ days: 1, daysLogged: 1, incomplete: false });
  const bar = totals.getByTestId("goal-chart").getByTestId("goal-bar");
  await expect(bar).toHaveCount(1);
  await expect(bar).toContainText("Protein");
  await expect(bar).toContainText("At least 155 g a day");
  await expect(bar).toHaveAttribute("data-status", "below");
  await expect(bar).toContainText("under your goal");
  await shot(page, info, "you-totals", "You: estimated totals, per-logged-day averages and a bar chart against daily goals");
});

test("log water, set a water goal, and compare eaten with FDA Daily Values", async ({ page, context }, info) => {
  await signIn(page, newEmail("water"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Plain rice");
  await page.getByLabel("Servings", { exact: true }).fill("1");
  await addIngredient(page, "rice white cooked", RICE);
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Unit").selectOption("g");
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Amount").fill("200");
  await saveAndSync(page);
  await page.getByRole("button", { name: "I ate this" }).click();
  const eat = page.getByRole("dialog", { name: "I ate this" });
  await eat.getByRole("button", { name: "Lunch" }).click();
  await eat.getByRole("button", { name: "Save as eaten" }).click();
  await expectSynced(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect
    .poll(async () => (await (await page.request.get(`${API}/v1/meals?from=${today}&to=${today}`)).json()).eaten.length)
    .toBe(1);
  const meals = await (await page.request.get(`${API}/v1/meals?from=${today}&to=${today}`)).json();
  const foodWater = meals.eaten[0].eaten.find((t: { key: string }) => t.key === "water").amount as number;
  expect(foodWater).toBeGreaterThan(0);

  await page.goto("/#/you");
  const card = page.getByTestId("water-today");
  await expect(card.getByTestId("water-split")).toContainText(`Drinks 0 ml · in food about ${Math.round(foodWater)} ml (estimated)`);
  await shot(page, info, "water-empty", "Water today: no drinks yet, water in the rice eaten shown separately as an estimate");
  await card.getByRole("button", { name: "Add a glass (250 ml)" }).click();
  await expect(card.getByTestId("water-drink")).toHaveCount(1);
  await expect(card.getByTestId("water-total")).toContainText(`${Math.round(250 + foodWater)} ml`);

  // Offline: a drink is saved on this device first, then synced.
  await context.setOffline(true);
  await card.getByLabel("Other amount").fill("0");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("1 to 5 L");
  await card.getByLabel("Other amount").fill("500");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.getByTestId("water-drink")).toHaveCount(2);
  await expect(card.getByTestId("water-drink").last()).toContainText("Saved on this device");
  await context.setOffline(false);
  await expectSynced(page);
  const water = await (await page.request.get(`${API}/v1/water?from=${today}&to=${today}`)).json();
  expect(water.drinks.map((d: { amountMl: number }) => d.amountMl)).toEqual([250, 500]);

  // A water goal compares with drinks plus water in food.
  await card.getByRole("link", { name: "Set a daily water goal" }).click();
  await page.getByRole("button", { name: "Add a goal" }).click();
  const goalSheet = page.getByRole("dialog", { name: "New goal" });
  await goalSheet.getByLabel("Nutrient").selectOption("water");
  await expect(goalSheet).toContainText("plus water in the foods");
  await goalSheet.getByLabel("Amount").fill("2000");
  await goalSheet.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByTestId("goal-card")).toContainText("At least 2 L a day");
  await expectSynced(page);
  await page.goto("/#/you");
  await expect(card.getByTestId("water-total")).toContainText("At least 2 L a day");
  const bar = page.getByTestId("goal-chart").getByTestId("goal-bar");
  await expect(bar).toContainText("Water");
  await expect(bar).toContainText("drinks and food");
  await expect(bar).toHaveAttribute("data-status", "below");
  await shot(page, info, "water-goal", "Water today with a daily goal; chart compares drinks plus food water with it");

  // Nutrients without a goal sit next to the FDA label Daily Values, as a reference.
  const dv = page.getByTestId("dv-chart");
  await dv.getByText("Other nutrients compared with FDA Daily Values").click();
  const protein = dv.getByTestId("dv-bar").filter({ hasText: "Protein" });
  await expect(protein).toContainText("FDA Daily Value 50 g");
  await expect(protein).toContainText("% of the Daily Value");
  await expect(dv.getByRole("link", { name: "FDA: Daily Value on the Nutrition Facts label" })).toHaveAttribute("href", /fda\.gov/);
  await dv.scrollIntoViewIfNeeded();
  await shot(page, info, "you-daily-values", "Other nutrients next to FDA Daily Values, labeled a reference for a 2,000-calorie adult diet");

  await card.getByRole("button", { name: /Remove 250 ml/ }).click();
  await expect(card.getByTestId("water-drink")).toHaveCount(1);
  await expectSynced(page);
  expect((await (await page.request.get(`${API}/v1/water?from=${today}&to=${today}`)).json()).drinks).toHaveLength(1);
});

test("calculate goals from published tables without storing what was typed", async ({ page }, info) => {
  await signIn(page, newEmail("calc"));
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") sent.push(r.postData() ?? "");
  });
  await page.goto("/#/goals");
  await page.getByRole("button", { name: "Help me calculate" }).click();
  const sheet = page.getByRole("dialog", { name: "Help me calculate goals" });
  await expect(sheet.getByTestId("calc-privacy")).toContainText("isn't saved, sent or added to reports");
  await sheet.getByRole("button", { name: "Show suggestions" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Choose a sex and an activity level");
  await sheet.getByRole("radio", { name: "Male", exact: true }).click();
  await sheet.getByLabel("Age").fill("17");
  await sheet.getByLabel("Height").fill("175");
  await sheet.getByLabel("Weight").fill("70");
  await sheet.getByRole("radio", { name: /Inactive/ }).check();
  await sheet.getByRole("button", { name: "Show suggestions" }).click();
  await expect(sheet.getByRole("alert")).toContainText("adults only");
  await shot(page, info, "calc-inputs", "Calculator: adults only; what is typed stays in this sheet");
  await sheet.getByLabel("Age").fill("30");
  await sheet.getByRole("button", { name: "Show suggestions" }).click();

  // Hand-worked from the 2023 National Academies equation: 753.07 - 10.83*30 + 6.50*175 + 14.10*70 = 2552.67, shown as 2,550.
  const results = sheet.getByTestId("calc-results");
  const row = (n: string) => results.locator(`[data-nutrient="${n}"]`);
  await expect(row("energy_kcal").getByLabel("Energy, lower amount")).toHaveValue("2210");
  await expect(row("energy_kcal").getByLabel("Energy, upper amount")).toHaveValue("2890");
  await expect(row("protein").getByLabel("Protein, lower amount")).toHaveValue("65");
  await expect(row("fiber").getByLabel("Fiber, at least")).toHaveValue("38");
  await expect(row("water").getByLabel("Water, at least")).toHaveValue("3700");
  await expect(results.getByRole("link", { name: /Dietary Reference Intakes for Energy/ })).toHaveAttribute("href", /nap\.nationalacademies\.org\/read\/26818/);
  await shot(page, info, "calc-results", "Suggested goals with how each was worked out and its source");

  // Edit one number, drop two rows, keep four.
  await row("protein").getByLabel("Protein, lower amount").fill("70");
  await row("fat_total").getByRole("checkbox").uncheck();
  await row("carbohydrate").getByRole("checkbox").uncheck();
  await sheet.getByRole("button", { name: "Save 4 goals" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("goal-card")).toHaveCount(4);
  await expectSynced(page);
  const { goals } = await (await page.request.get(`${API}/v1/goals`)).json();
  const byKey = Object.fromEntries(goals.map((g: { nutrientKey: string }) => [g.nutrientKey, g]));
  expect(Object.keys(byKey).sort()).toEqual(["energy_kcal", "fiber", "protein", "water"]);
  expect(byKey.protein).toMatchObject({ kind: "between", min: 70, max: 225, period: "day" });
  expect(byKey.water).toMatchObject({ kind: "at_least", unit: "g", min: 3700 });
  await shot(page, info, "calc-goals-saved", "Only the kept goals are saved");

  // Nothing typed was sent, kept on the device, or put in the activity log.
  const keys = new Set<string>();
  for (const body of sent) {
    for (const op of JSON.parse(body || "{}").operations ?? []) Object.keys(op.body ?? {}).forEach((k) => keys.add(k));
  }
  expect([...keys].sort()).toEqual(["endDate", "kind", "max", "min", "nutrientKey", "period", "startDate", "unit"]);
  expect(sent.join(" ")).not.toMatch(/heightCm|weightKg|"age"|"sex"|"activity"/);
  const stored = await page.evaluate(async () => {
    const dumps: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("betterplate-user-")) continue;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        dumps.push(await new Promise<string>((res) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(JSON.stringify(r.result));
        }));
      }
      db.close();
    }
    return dumps.join(" ");
  });
  expect(stored).not.toMatch(/heightCm|weightKg|"sex"|"age"|"activity"/);
});

test("cook mode shows your steps one at a time, timers, and cited safe temperatures", async ({ page }, info) => {
  await signIn(page, newEmail("cook"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Seared chicken");
  await addIngredient(page, "chicken breast raw", "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
  await page.getByLabel("Method").fill("1. Pat the chicken dry and season.\n2. Sear 6 minutes per side.\n3. Rest before slicing.");
  await saveAndSync(page);

  await page.getByRole("link", { name: "Cook" }).click();
  await expect(page.getByTestId("cook-mode")).toContainText("Before you start");
  const safe = page.getByTestId("safe-temperatures");
  await expect(safe).toContainText("165°F (74°C)");
  await expect(safe.getByRole("link")).toHaveAttribute("href", /foodsafety\.gov/);
  await shot(page, info, "cook-before-start", "Cook mode: safe minimum temperature from FoodSafety.gov with source");

  await page.getByRole("button", { name: "Start cooking" }).click();
  await expect(page.getByTestId("cook-step")).toHaveText("Pat the chicken dry and season.");
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByTestId("cook-timer")).toContainText("06:00");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await shot(page, info, "cook-step-timer", "Step 2 of 3 with the timer the cook wrote (6 minutes)");
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("link", { name: "Done" }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Seared chicken");
});

test("report an issue from any screen: readable steps, previewed screenshot, offline queue", async ({ page, context }, info) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Report an issue" })).toBeVisible();
  await signIn(page, newEmail("report"));
  await page.getByTestId("today-card").click();
  await expect(page.getByTestId("eaten-card")).toBeVisible();

  await page.getByRole("button", { name: "Report an issue" }).click();
  const sheet = page.getByRole("dialog", { name: "Report an issue" });
  await expect(sheet.getByTestId("report-steps")).toContainText("Opened Meals");
  await sheet.getByLabel("What happened?").fill("The day total looks wrong");
  await sheet.getByLabel("Include a screenshot of this screen").check();
  await expect(sheet.getByRole("img", { name: /Screenshot that will be sent/ })).toBeVisible();
  await shot(page, info, "report-sheet", "Report: readable recent steps (removable) and screenshot preview with typed text hidden");

  const sent = page.waitForResponse((r) => r.url().endsWith("/v1/feedback") && r.request().method() === "POST");
  await sheet.getByRole("button", { name: "Send report" }).click();
  const res = await sent;
  expect(res.status()).toBe(201);
  const payload = res.request().postDataJSON();
  expect(payload).toMatchObject({ kind: "bug", message: "The day total looks wrong", context: { route: "/meals" } });
  expect(payload.screenshot).toMatch(/^data:image\/jpeg;base64,/);
  expect(payload.activity.map((a: { event: string }) => a.event)).toContain("Opened Meals");
  await expect(page.getByTestId("report-done")).toContainText("Your report was sent");
  await page.getByRole("button", { name: "Done" }).click();

  // Offline: the approved report waits on this device and is sent on reconnect.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Report an issue" }).click();
  await page.getByLabel("What happened?").fill("Sent while offline");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByTestId("report-done")).toContainText("saved on this device");
  await shot(page, info, "report-queued-offline", "Offline report saved on this device until reconnect");
  await page.getByRole("button", { name: "Done" }).click();
  const flushed = page.waitForResponse((r) => r.url().endsWith("/v1/feedback") && r.request().method() === "POST");
  await context.setOffline(false);
  expect((await flushed).status()).toBe(201);
});

test("recipe names with markup are shown as text, never run", async ({ page }, info) => {
  await signIn(page, newEmail("xss"));
  await page.getByRole("button", { name: "New recipe" }).click();
  const evil = `<img src=x onerror="window.__xss=1">Soup`;
  await page.getByLabel("Recipe name").fill(evil);
  await saveAndSync(page);
  await page.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(page.getByTestId("recipe-card")).toContainText(evil);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await shot(page, info, "xss-name-as-text", "Markup in a recipe name is displayed literally");
});

test("share a recipe: review what is shared, open the link signed out, then revoke it", async ({ page, browser, context }, info) => {
  const email = newEmail("share");
  await signIn(page, email);
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Rice for friends");
  await page.getByLabel("Description").fill("A quick side for a crowd.");
  await addIngredient(page, "rice white cooked", RICE);
  await addIngredient(page, "olive", OIL);
  await page.getByLabel("Method").fill("Warm the rice.\nStir in the oil.");
  await saveAndSync(page);

  // Offline: the link cannot be created, and the sheet says why.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Share recipe" }).click();
  const sheet = page.getByRole("dialog", { name: "Share recipe" });
  await expect(sheet).toContainText("Creating a link needs an internet connection");
  await context.setOffline(false);
  await expect(sheet.getByTestId("share-preview")).toContainText("Never your name, email, meals or other recipes");
  await sheet.getByLabel("Include my method").check();
  await expect(sheet.getByTestId("share-preview")).toContainText("Your method, word for word");
  await shot(page, info, "share-review", "Share sheet: exactly what a link holder will see, method opt-in, expiry");
  await sheet.getByRole("button", { name: "Create link" }).click();
  await expect(sheet.getByTestId("share-created")).toBeVisible();
  const url = await sheet.getByLabel("Link", { exact: true }).inputValue();
  expect(url).toMatch(/^http:\/\/localhost:4100\/s\/[0-9a-f-]{36}$/);
  await expect(sheet.getByTestId("share-links").getByRole("listitem")).toHaveCount(1);
  await shot(page, info, "share-created", "Link ready: native share, copy, email and text fallbacks; active links with Revoke");

  // Someone without an account opens the link.
  const guest = await browser.newContext();
  const reader = await guest.newPage();
  await reader.goto(url);
  await expect(reader).toHaveURL(/\/#\/shared\/[0-9a-f-]{36}$/);
  const shared = reader.getByTestId("shared-recipe");
  await expect(shared.getByRole("heading", { name: "Rice for friends" })).toBeVisible();
  await expect(shared).toContainText(RICE);
  await expect(shared).toContainText("Stir in the oil.");
  await expect(shared).toContainText("A quick side for a crowd.");
  await expect(shared).toContainText("counted as eaten");
  await expect(reader.getByTestId("shared-nutrient-energy_kcal")).toContainText("kcal");
  await expect(reader.locator("body")).not.toContainText(email);
  await expect(reader.getByRole("link", { name: "Make your own in The Better Plate" })).toBeVisible();
  await shot(reader, info, "shared-recipe-guest", "Shared recipe opened signed out: ingredients, method, estimate with USDA source");

  // The owner revokes it; the link stops working.
  page.once("dialog", (d) => void d.accept());
  await sheet.getByTestId("share-links").getByRole("button", { name: "Revoke" }).click();
  await expect(sheet.getByTestId("share-links")).toHaveCount(0);
  await reader.reload();
  await expect(reader.getByTestId("share-gone")).toContainText("This link no longer works");
  await shot(reader, info, "shared-recipe-revoked", "Revoked link: nothing of the recipe remains");
  await guest.close();
});

test("when the browser clears local data or runs out of space, the app says so and recovers", async ({ page }, info) => {
  await signIn(page, newEmail("evict"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Survives eviction");
  await addIngredient(page, "broccoli raw", BROCCOLI);
  await saveAndSync(page);

  // Simulate the browser evicting this site's personal database under storage pressure.
  await page.goto("/#/kitchen");
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const name = dbs.find((d) => d.name?.startsWith("betterplate-user-"))!.name!;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByTestId("storage-banner")).toContainText("This browser cleared your kitchen from this device");
  await expect(page.getByTestId("recipe-card")).toContainText("Survives eviction");
  await shot(page, info, "storage-evicted", "After eviction: plain notice, synced recipes restored from the account");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("storage-banner")).toHaveCount(0);

  // A save that fails for lack of space.
  await page.evaluate(() => {
    void Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
  });
  await expect(page.getByTestId("storage-banner")).toContainText("This device is out of storage");
  await expect(page.getByRole("button", { name: "Download unsynced changes" })).toBeVisible();
  await shot(page, info, "storage-full", "Out of space: what happened and how to keep unsynced changes");

  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByTestId("storage-info")).toContainText("MB used");
});

test("use the app in Spanish: interface, Spanish food words, nutrient names and safety chart", async ({ page }, info) => {
  await signIn(page, newEmail("es"));
  await page.getByRole("link", { name: "You" }).click();
  await page.getByLabel("Language").selectOption("es");
  await expect(page.getByRole("heading", { name: "Cuenta" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await shot(page, info, "es-account", "Language switch on the You screen; interface in Spanish");

  await page.getByRole("link", { name: "Cocina" }).click();
  await page.getByRole("button", { name: "Nueva receta" }).click();
  await page.getByLabel("Nombre de la receta").fill("Pollo a la plancha");
  await page.getByRole("button", { name: "Agregar ingrediente" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar ingrediente" });
  await dialog.getByLabel("Buscar alimentos").fill("pechuga de pollo cruda");
  await expect(dialog).toContainText("Los nombres de los alimentos vienen del USDA en inglés");
  await shot(page, info, "es-food-search", "Spanish words find USDA foods, whose names stay in English");
  await dialog.getByRole("list", { name: "Alimentos" }).getByRole("button", { name: /^Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw/ }).first().click();
  await page.getByLabel("Preparación").fill("1. Seca el pollo.\n2. Dóralo 6 minutos por lado.");
  await page.getByRole("button", { name: "Guardar receta" }).click();
  await expect(page.getByTestId("save-message")).toContainText("Guardado en este dispositivo");
  await expect(page.getByTestId("sync-status")).toHaveText("Sincronizado", { timeout: 15_000 });
  const panel = page.getByTestId("nutrition-panel");
  await expect(panel).toContainText("Nutrición");
  await expect(panel).toContainText("Proteína");
  await expect(panel).toContainText("Valores Diarios de la FDA");
  await expect(panel).toContainText("Define tus propias metas diarias");
  await expect(panel).not.toContainText("%");
  await shot(page, info, "es-recipe", "Recipe editor and nutrition panel in Spanish, decimal commas");

  await page.getByRole("link", { name: "Cocinar" }).click();
  const safe = page.getByTestId("safe-temperatures");
  await expect(safe).toContainText("Temperaturas internas mínimas seguras");
  await expect(safe).toContainText("165°F (74°C)");
  await expect(safe).toContainText("Pollo, pavo y otras aves");
  await shot(page, info, "es-cook", "Cook mode safety chart in Spanish, still citing FoodSafety.gov");
  await page.getByRole("link", { name: "Salir" }).click();

  // Back to English for anyone else on this device.
  await page.getByRole("link", { name: "Tú" }).click();
  await page.getByLabel("Idioma").selectOption("en");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
});
