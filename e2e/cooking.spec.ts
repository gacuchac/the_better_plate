import { expect, test } from "@playwright/test";
import { addIngredient, API, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const SPINACH = "Spinach, raw";

test("each ingredient is cooked or raw, and cooking lowers vitamins but not energy", async ({ page }, info) => {
  await signIn(page, newEmail("cooking"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Spinach two ways");
  await page.getByLabel("Servings", { exact: true }).fill("1");
  await page.getByLabel("Method").fill("1. Wash the spinach.\n2. Toss with lemon and serve.");
  await addIngredient(page, "spinach raw", SPINACH);
  const row = page.getByTestId("ingredient-row").filter({ hasText: SPINACH });
  await row.getByLabel("Unit").selectOption("g");
  await row.getByLabel("Amount").fill("100");

  // No heating step names the spinach, so it is guessed raw and marked as a guess.
  const state = row.getByLabel("In this recipe");
  await expect(state).toHaveValue("raw");
  await expect(row.getByTestId("cooking-guessed")).toBeVisible();
  await expect(page.getByTestId("cooking-note")).toHaveCount(0);

  await page.getByRole("button", { name: "Show vitamins and minerals" }).click();
  const value = (key: string) => page.getByTestId(`nutrient-${key}`).locator(".nutrient-value");
  const rawVitC = await value("vitamin_c").textContent();
  const rawEnergy = await value("energy_kcal").textContent();
  await shot(page, info, "spinach-raw-guessed", "Spinach guessed raw from the method, with the guess shown");

  await state.selectOption("boiled");
  await expect(row.getByTestId("cooking-guessed")).toHaveCount(0);
  await expect(page.getByTestId("cooking-note")).toContainText("USDA nutrient retention factors");
  await expect(value("vitamin_c")).not.toHaveText(rawVitC!);
  await expect(value("energy_kcal")).toHaveText(rawEnergy!);
  await shot(page, info, "spinach-boiled", "Boiled: vitamin C reduced by the USDA factor, energy unchanged");

  await saveAndSync(page);
  const { recipes } = await (await page.request.get(`${API}/v1/recipes`)).json();
  const saved = recipes.find((r: { title: string }) => r.title === "Spinach two ways");
  expect(saved.ingredients[0].cooking).toEqual({ state: "cooked", method: "boiled", source: "stated" });
  expect(saved.nutrition.engineVersion).toBe("2.0.0");
  const vitC = (n: { totals: { key: string; amount: number }[] }) => n.totals.find((t) => t.key === "vitamin_c")!.amount;
  const rawCalc = await (
    await page.request.post(`${API}/v1/recipes/calculate`, {
      data: { servings: 1, ingredients: [{ ...saved.ingredients[0], cooking: { state: "raw", method: null, source: "stated" } }] },
    })
  ).json();
  expect(vitC(saved.nutrition)).toBeLessThan(vitC(rawCalc));
});
