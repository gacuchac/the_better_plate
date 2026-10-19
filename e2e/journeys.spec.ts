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
  await expect(page.getByRole("dialog")).toContainText("FDA Daily Values");
  await shot(page, info, "meals-day-nutrients", "Day nutrients with % of FDA Daily Values and source");
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
