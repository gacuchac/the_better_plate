import { expect, test } from "@playwright/test";
import { addIngredient, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";

// Opt-in community recipes: an author reviews and shares a snapshot; someone else sees it on home,
// opens it without learning who shared it, saves a copy to their own kitchen and can report it.
test("community: share a recipe, another person finds it on home, saves a copy and reports it", async ({ page, browser }, info) => {
  const title = `Community rice ${Date.now()}`;
  await signIn(page, newEmail("author"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill(title);
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await addIngredient(page, "rice white cooked", RICE);
  await saveAndSync(page);

  await page.getByRole("button", { name: "Share with the community" }).click();
  const sheet = page.getByRole("dialog", { name: "Share with the community" });
  await expect(sheet.getByTestId("community-preview")).toContainText(title);
  await shot(page, info, "community-review", "Before sharing: what everyone signed in will see, and what they never see");
  await sheet.getByRole("button", { name: "Share with the community" }).click();
  await expect(sheet.getByTestId("community-shared")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Stop sharing" })).toBeVisible();

  const other = await browser.newContext();
  const reader = await other.newPage();
  await signIn(reader, newEmail("reader"));
  const tile = reader.getByTestId("trending-section").getByTestId("community-tile").filter({ hasText: title });
  await expect(tile).toBeVisible();
  await shot(reader, info, "community-home", "Another person's home: plan first, then favorites, trending and an adventure pick");
  await tile.click();

  const recipe = reader.getByTestId("community-recipe");
  await expect(recipe.getByRole("heading", { name: title })).toBeVisible();
  await expect(recipe).not.toContainText("@example.test");
  await reader.getByRole("button", { name: "Report" }).click();
  const report = reader.getByRole("dialog", { name: "Report this recipe" });
  await report.getByLabel("Spam or advertising").check();
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByTestId("report-done")).toBeVisible();
  await report.getByRole("button", { name: "Close" }).click();

  await reader.getByRole("button", { name: "Save a copy to my kitchen" }).click();
  await expect(reader.getByLabel("Recipe name")).toHaveValue(title);
  await expectSynced(reader);
  await shot(reader, info, "community-copy", "The saved copy is the reader's own recipe, without the author's photo");
  await other.close();
});
