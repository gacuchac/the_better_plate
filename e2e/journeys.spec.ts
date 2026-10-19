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
  await page.getByLabel("Servings").fill("2");
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

  await page.getByRole("link", { name: "‹ Recipes" }).click();
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
  await expect(page.getByRole("heading", { name: "Your kitchen, with you everywhere" })).toBeVisible();
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
  await l.getByRole("link", { name: "‹ Recipes" }).click();
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
