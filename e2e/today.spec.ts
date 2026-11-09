import { expect, test } from "@playwright/test";
import { addIngredient, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";

// Today on Your Kitchen: an empty day leads with cooking; a day with a plan shows the trail with
// one-tap Eat and Undo; a goal the person set gets a mark, and going past it is stated calmly.
test("today: empty day, planned trail with Eat and Undo, and a calm note past a calorie goal", async ({ page }, info) => {
  await signIn(page, newEmail("today"));
  await expect(page.getByTestId("today-card")).toContainText("Nothing planned yet");
  await expect(page.getByRole("heading", { name: "Let's cook something" })).toBeVisible();
  await shot(page, info, "today-empty", "Empty day: cooking leads, the trail is one quiet card");

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
  await shot(page, info, "today-empty-with-recipes", "Empty day with a saved recipe: cooking leads with a recipe grid");
  await page.getByTestId("recipe-card").click();
  await page.getByRole("button", { name: "Plan" }).click();
  const plan = page.getByRole("dialog", { name: "Plan this meal" });
  await plan.getByRole("button", { name: "Dinner" }).click();
  await plan.getByRole("button", { name: "Add to plan" }).click();
  await expect(plan).toBeHidden();
  await page.getByRole("link", { name: "Back to Kitchen" }).click();

  const items = page.getByTestId("trail-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveClass(/is-planned/);
  await expect(page.getByTestId("cook-row")).toContainText("Let's cook something");
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
