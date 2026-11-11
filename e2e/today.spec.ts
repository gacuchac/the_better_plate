import { expect, test } from "@playwright/test";
import { addIngredient, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

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
  await page.getByRole("link", { name: "Back to Kitchen" }).click();
  await expect(page.getByTestId("today-card")).toContainText("Nothing planned yet");
  await expect(page.locator(".tile")).toHaveCount(1);
  await shot(page, info, "today-empty-with-recipes", "Empty day with a saved recipe: empty plan first, then the recipe grid");
  await page.locator(".tile").click();
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
  await expect(page.locator(".meter-mark")).toHaveCount(1);
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
  await shot(page, info, "gentle-mode-today", "Gentle mode: no mark and no over wording on Today");
  await page.goto("/#/goals");
  await page.getByLabel("Gentle mode").uncheck();
  await page.goto("/#/kitchen");
  await expect(page.locator(".meter-mark")).toHaveCount(1);
});
