import { expect, test } from "@playwright/test";
import { addIngredient, API, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";

// Today on Your Kitchen: the plan always comes first (an empty-plan card when nothing is planned),
// then "Let's cook something"; a day with a plan shows the trail with one-tap Eat and Undo; a goal the person set gets a mark, and going past it is stated calmly.
async function expectPlanFirst(page: import("@playwright/test").Page) {
  const plan = await page.getByTestId("today-card").boundingBox();
  const cook = await page.getByTestId("cook-section").boundingBox();
  expect(plan && cook && plan.y < cook.y).toBe(true);
}

test("today: empty day, planned trail with Eat and Undo, and a calm note past a calorie goal", async ({ page }, info) => {
  await signIn(page, newEmail("today"));
  await expect(page.getByTestId("today-card")).toContainText("Nothing planned yet");
  await expect(page.getByRole("heading", { name: "Let's cook something" })).toBeVisible();
  await expectPlanFirst(page);
  await shot(page, info, "today-empty", "Empty day: the empty plan comes first, then Let's cook something");

  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Plain rice");
  await page.getByLabel("Servings", { exact: true }).fill("1");
  await addIngredient(page, "rice white cooked", RICE);
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Unit").selectOption("g");
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Amount").fill("400");
  await saveAndSync(page);
  const heart = page.getByTestId("favorite-toggle");
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expectSynced(page);
  await page.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(page.getByTestId("today-card")).toContainText("Nothing planned yet");
  // Home no longer lists every recipe: only favorites, trending and one adventure pick.
  const favorites = page.getByTestId("favorites-section");
  await expect(favorites.locator(".tile")).toHaveCount(1);
  await expect(page.getByTestId("adventure-card")).toBeVisible();
  await shot(page, info, "today-empty-with-favorite", "Empty day with a favorite: empty plan first, then favorites, trending and an adventure pick");
  await favorites.locator(".tile").click();
  await page.getByRole("button", { name: "Plan" }).click();
  const plan = page.getByRole("dialog", { name: "Plan this meal" });
  await plan.getByRole("button", { name: "Dinner" }).click();
  await plan.getByRole("button", { name: "Add to plan" }).click();
  await expect(plan).toBeHidden();
  await page.getByRole("link", { name: "Back to Kitchen" }).click();

  const items = page.getByTestId("trail-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveClass(/is-planned/);
  await expect(page.getByRole("heading", { name: "Let's cook something" })).toBeVisible();
  await expectPlanFirst(page);
  await shot(page, info, "today-planned", "Day with a plan: dashed trail, outlined pin, Eat button");

  await page.getByRole("button", { name: "Mark Plain rice as eaten" }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveClass(/is-eaten/);
  await expect(page.getByTestId("today-card")).toContainText("Eaten1 meal");
  await expectSynced(page);
  await shot(page, info, "today-eaten", "Eaten meal: filled, checked pin and an Undo button; kcal estimated, no goal so no mark");
  await expect(page.locator(".meter-mark")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo eating Plain rice" }).click();
  await expect(items.first()).toHaveClass(/is-planned/);
  await page.getByRole("button", { name: "Mark Plain rice as eaten" }).click();
  await expect(items.first()).toHaveClass(/is-eaten/);

  // A personal calorie goal well under what was eaten: the bar gets a mark and a calm sentence.
  await page.goto("/#/goals");
  await page.getByRole("button", { name: "Add a goal" }).click();
  const sheet = page.getByRole("dialog", { name: "New goal" });
  await sheet.getByLabel("Nutrient").selectOption("energy_kcal");
  await sheet.getByLabel("Goal").selectOption("at_most");
  await sheet.getByLabel("Amount").fill("100");
  await sheet.getByRole("button", { name: "Save goal" }).click();
  await expectSynced(page);
  await page.goto("/#/kitchen");
  await expect(page.getByTestId("today-card").locator(".meter-mark")).toHaveCount(1);
  await expect(page.locator(".calm")).toContainText("above your goal today. Tomorrow is a fresh day.");
  await shot(page, info, "today-over-goal", "Past a personal goal: same green, a dark mark, deeper green beyond it, plain words, no red or banner");
});

test("meal plan week strip: seven days, pick one", async ({ page }, info) => {
  await signIn(page, newEmail("strip"));
  await page.goto("/#/meals");
  const strip = page.getByRole("navigation", { name: "Week" });
  await expect(strip.getByRole("button")).toHaveCount(7);
  await expect(strip.locator('[aria-current="date"]')).toHaveCount(1);
  await shot(page, info, "meal-plan-week-strip", "Meal plan: the week as a strip, the chosen day filled");
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
  await strip.getByRole("button").first().click();
  await expect(strip.locator('[aria-current="date"]')).toHaveCount(1);
});

test("goals: own-goal note, Help me choose, and gentle mode hides marks and over wording", async ({ page }, info) => {
  await signIn(page, newEmail("gentle"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Plain rice");
  await page.getByLabel("Servings", { exact: true }).fill("1");
  await addIngredient(page, "rice white cooked", RICE);
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Unit").selectOption("g");
  await page.getByTestId("ingredient-row").filter({ hasText: RICE }).getByLabel("Amount").fill("400");
  await saveAndSync(page);
  await page.getByRole("button", { name: "I ate this" }).click();
  await page.getByRole("dialog", { name: "I ate this" }).getByRole("button", { name: "Save as eaten" }).click();
  await expectSynced(page);

  await page.goto("/#/goals");
  await page.getByRole("button", { name: "Add a goal" }).click();
  const sheet = page.getByRole("dialog", { name: "New goal" });
  await expect(sheet.getByTestId("own-goal-note")).toHaveText("This is your own goal, not advice.");
  await shot(page, info, "set-a-goal-sheet", "Set a goal: own-goal note, Help me choose, nutrient, kind and your number");
  await sheet.getByRole("button", { name: "Help me choose" }).click();
  await expect(page.getByRole("dialog", { name: /calculate/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/#/goals");
  await page.getByRole("button", { name: "Add a goal" }).click();
  const again = page.getByRole("dialog", { name: "New goal" });
  await again.getByLabel("Nutrient").selectOption("energy_kcal");
  await again.getByLabel("Goal").selectOption("at_most");
  await again.getByLabel("Amount").fill("100");
  await again.getByRole("button", { name: "Save goal" }).click();
  await expectSynced(page);
  await page.goto("/#/kitchen");
  await expect(page.locator(".calm")).toBeVisible();

  await page.goto("/#/goals");
  await page.getByLabel("Gentle mode").check();
  await expect(page.getByTestId("goal-status")).toHaveCount(0);
  await shot(page, info, "gentle-mode-goals", "Gentle mode on: goals kept, progress words hidden");
  await page.goto("/#/kitchen");
  await expect(page.locator(".calm")).toHaveCount(0);
  await expect(page.locator(".meter-mark")).toHaveCount(0);
  await expect(page.getByTestId("week-card")).toHaveCount(0);
  await shot(page, info, "gentle-mode-today", "Gentle mode: no mark, no over wording and no weekly card on Today");
  await page.goto("/#/goals");
  await page.getByLabel("Gentle mode").uncheck();
  await page.goto("/#/kitchen");
  await expect(page.getByTestId("today-card").locator(".meter-mark")).toHaveCount(1);
  await expect(page.getByTestId("week-card").locator(".meter-mark")).toHaveCount(1);
});

// Weekly tracking: the last 7 days next to today, each day counted with the goal it had then,
// so changing a goal mid-week keeps the earlier days at their old amount.
test("last 7 days: adds each day's own goal, and a changed goal keeps its earlier days", async ({ page }, info) => {
  await signIn(page, newEmail("week"));
  const day = (offset: number) =>
    page.evaluate((o) => {
      const d = new Date();
      d.setDate(d.getDate() + o);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, offset);
  const [sixAgo, twoAgo] = [await day(-6), await day(-2)];
  const rice = ((await (await page.request.get(`${API}/v1/foods?query=${encodeURIComponent(RICE)}&limit=1`)).json()) as { foods: { id: string }[] }).foods[0]!.id;
  const seeded = await page.request.post(`${API}/v1/sync/batch`, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      protocol: 1,
      operations: [
        { opId: crypto.randomUUID(), type: "goal.put", entityId: crypto.randomUUID(), baseVersion: null,
          body: { nutrientKey: "energy_kcal", unit: "kcal", kind: "at_most", min: null, max: 1000, period: "day", startDate: sixAgo, endDate: null } },
        { opId: crypto.randomUUID(), type: "log.create", entityId: crypto.randomUUID(),
          body: { plannedMealId: null, recipeId: crypto.randomUUID(), recipe: { title: "Plain rice", servings: 1, ingredients: [{ id: crypto.randomUUID(), foodId: rice, quantity: 200, unit: "g", role: "ingredient" }] },
            servings: 1, slot: "lunch", localDate: twoAgo, eatenAt: `${twoAgo}T12:00:00Z` } },
      ],
    },
  });
  expect(seeded.ok()).toBe(true);
  await page.goto("/#/kitchen");
  await page.reload();
  const line = page.getByTestId("week-line");
  // Two days count (the logged one and today), each with a 1,000 kcal goal.
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/of 2,?000 kcal/);
  await expect(line).toContainText("2 days counted");
  await expect(line.getByTestId("week-left")).toContainText("left for today");
  await shot(page, info, "week-card", "Last 7 days next to today: eaten against the sum of each day's own goal, room left for today");

  await page.goto("/#/goals");
  await page.getByRole("button", { name: /^Edit .* goal$/ }).click();
  const sheet = page.getByRole("dialog", { name: "Edit goal" });
  await sheet.getByLabel("Amount").fill("1500");
  await expect(sheet.getByTestId("goal-keeps-history")).toContainText("keep the old amount");
  await shot(page, info, "goal-edit-keeps-history", "Changing a running goal's amount: earlier days keep the old one");
  await sheet.getByRole("button", { name: "Save goal" }).click();
  await expectSynced(page);
  await expect(page.getByTestId("goal-card")).toHaveCount(2);

  await page.goto("/#/kitchen");
  await expect(line).toContainText(/of 2,?500 kcal/);
  await shot(page, info, "week-card-after-change", "After the change: the earlier day keeps 1,000 kcal, today counts 1,500");
});
