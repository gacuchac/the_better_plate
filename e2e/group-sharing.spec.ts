import { expect, test, type Page } from "@playwright/test";
import { addIngredient, API, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";
const SPINACH = "Spinach, raw";

async function newRecipe(page: Page, title: string, description: string) {
  await page.goto("/#/create");
  await page.getByLabel("Recipe name").fill(title);
  await page.getByLabel("Servings", { exact: true }).fill("2");
  for (const [search, exact, grams] of [["rice white cooked", RICE, 300], ["spinach raw", SPINACH, 100]] as const) {
    await addIngredient(page, search, exact);
    const row = page.getByTestId("ingredient-row").filter({ hasText: exact });
    await row.getByLabel("Unit").selectOption("g");
    await row.getByLabel("Amount").fill(String(grams));
  }
  const about = page.getByLabel("Description");
  if (await about.count()) await about.fill(description);
  await saveAndSync(page);
}

test("an admin adds someone by email and shares a meal; they join on first sign-in, say what they'd like, and the admin plans it for everyone", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const grandmaEmail = newEmail(`grandma-${info.project.name}`);

  // Mom starts a group and saves a recipe to share.
  await signIn(page, newEmail(`mom-share-${info.project.name}`));
  await newRecipe(page, "Green rice", "Rice with lots of spinach.");
  await page.goto("/#/groups");
  await page.getByLabel("Group name").fill("The Okafors");
  await page.getByLabel("Your name in the group").fill("Mom");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "The Okafors" })).toBeVisible();

  // Grandma has no account yet: Mom adds her by email.
  await page.getByTestId("add-by-email").click();
  const add = page.getByRole("dialog", { name: "Add someone by email" });
  await add.getByLabel("Email").fill(grandmaEmail);
  await add.getByLabel("Name the group will see").fill("Grandma");
  await shot(page, info, "add-by-email", "Admin adds someone by email");
  await add.getByTestId("add-by-email-submit").click();
  await expect(page.getByTestId("group-note")).toContainText("Added Grandma and emailed them");
  await expect(page.getByTestId("pending-member")).toContainText("Invited, hasn't joined yet");
  // The invite email went to the local test mailbox, never to a real address.
  const mail = await (await page.request.get(`${API}/v1/dev/mailbox?email=${encodeURIComponent(grandmaEmail)}`)).json();
  expect(mail.messages[0].subject).toBe("Mom added you to The Okafors on The Better Plate");

  // Mom shares the meal: a card, not the recipe.
  await page.getByTestId("share-meal-open").click();
  const sheet = page.getByRole("dialog", { name: "Share a meal" });
  await sheet.getByLabel("Recipe", { exact: true }).selectOption({ label: "Green rice" });
  await sheet
    .getByLabel("Description", { exact: true })
    .fill(
      "Rice with lots of spinach. Would you eat this on Sunday? It takes about half an hour, keeps well for two days in the fridge, and goes with grilled chicken, a fried egg or white beans. Kids usually like it best with a squeeze of lime and a little cheese on top.",
    );
  await shot(page, info, "share-meal-sheet", "Share sheet: recipe, description, photo choice");
  await sheet.getByTestId("share-meal-submit").click();
  // A quick list row: small picture (a tinted letter when there is no photo), name, description, macros, thumbs.
  const card = page.getByTestId("shared-meal").filter({ hasText: "Green rice" });
  await expect(card).toContainText("Would you eat this on Sunday?");
  await expect(card.getByTestId("shared-monogram")).toHaveText("G");
  await expect(card).toContainText(/kcal · .+ protein · .+ carbs · .+ fat/);
  await expect(card).not.toContainText("Spinach, raw");
  await expect(card.getByRole("button", { name: "I'd like this" })).toBeVisible();
  // A long description shows its first lines; See more opens the rest in place, See less folds it back.
  const more = card.getByTestId("see-more");
  await expect(more).toHaveText("See more");
  await more.click();
  await expect(more).toHaveText("See less");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await more.click();
  await expect(more).toHaveText("See more");
  await shot(page, info, "shared-meal-list", "Shared meals as a quick list: picture, name, description, macros, thumbs");
  await card.getByTestId("shared-meal-open").click();
  const detail = page.getByRole("dialog", { name: "Green rice" });
  await expect(detail).toContainText("Rice with lots of spinach. Would you eat this on Sunday?");
  await expect(detail).toContainText("Estimated, per serving");
  await expect(detail).toContainText("Sodium");
  await shot(page, info, "shared-meal-detail", "Tapping a meal: the whole description and every nutrient");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  // It's Mom's own recipe, so tapping the meal opens her full recipe with Cook it.
  await card.getByTestId("shared-meal-recipe").click();
  await expect(page.getByRole("button", { name: "Cook it" }).or(page.getByRole("link", { name: "Cook it" })).first()).toBeVisible();
  await shot(page, info, "own-shared-meal-recipe", "The admin's own shared meal opens her full recipe with Cook it");
  await page.goBack();
  await expect(card).toBeVisible();

  // Grandma signs in for the first time and is in the group straight away; Home says who added her, with Leave.
  const context = await browser.newContext({ ...info.project.use });
  const grandma = await context.newPage();
  await signIn(grandma, grandmaEmail);
  const welcome = grandma.getByTestId("group-welcome");
  await expect(welcome).toContainText("Mom added you to The Okafors.");
  await expect(welcome.getByRole("button", { name: "Leave group" })).toBeVisible();
  await shot(grandma, info, "first-sign-in-welcome", "First sign-in: she is in the group, Home says who added her, and she can leave");
  await welcome.getByRole("link", { name: "Open the group" }).click();
  await expect(grandma.getByRole("heading", { name: "The Okafors" })).toBeVisible();

  // The shared meal was waiting for her: one tap says she'd like it, and she adds a comment on the meal itself.
  const hers = grandma.getByTestId("shared-meal").filter({ hasText: "Green rice" });
  await expect(hers).toBeVisible();
  await expect(hers.getByTestId("meal-tally")).toHaveCount(0);
  // Not her recipe: no way to the full recipe, only the short view.
  await expect(hers.getByTestId("shared-meal-recipe")).toHaveCount(0);
  await hers.getByRole("button", { name: "I'd like this" }).click();
  await expect(hers.getByRole("button", { name: "I'd like this" })).toHaveAttribute("aria-pressed", "true");
  await shot(grandma, info, "member-thumbs-up", "Member's list: thumbs up in one tap");
  await hers.getByTestId("shared-meal-open").click();
  const mine = grandma.getByRole("dialog", { name: "Green rice" });
  await expect(mine.getByTestId("meal-answers")).toHaveCount(0);
  await mine.getByLabel("Comment (optional)").fill("Less salt for me, please");
  await mine.getByTestId("save-reaction").click();
  await expect(mine.getByTestId("my-reaction")).toContainText("You'd like this");
  await expect(mine.getByTestId("my-reaction")).toContainText("Less salt for me, please");
  await shot(grandma, info, "member-reacted", "Member's view: her own answer and comment only");
  await grandma.keyboard.press("Escape");

  // Mom sees who would like it and the comment.
  await page.reload();
  const row = page.getByTestId("shared-meal").filter({ hasText: "Green rice" });
  await expect(row.getByTestId("meal-tally")).toContainText("1 would like it");
  await row.getByTestId("shared-meal-open").click();
  const answers = page.getByRole("dialog", { name: "Green rice" }).getByTestId("meal-answers");
  await expect(answers.getByTestId("meal-answer")).toContainText("Grandma · I'd like this");
  await expect(answers.getByTestId("meal-answer")).toContainText("Less salt for me, please");
  await shot(page, info, "admin-answers", "Admin's view: everyone's answers and comments");

  // Mom plans the meal Grandma liked for the whole group, straight from the shared meal.
  await page.getByRole("dialog", { name: "Green rice" }).getByTestId("plan-shared-meal").click();
  const plan = page.getByRole("dialog", { name: "Plan a meal for The Okafors" });
  await expect(plan.getByLabel("Recipe", { exact: true })).toHaveValue(/.+/);
  await expect(plan.getByLabel("Recipe", { exact: true }).locator("option:checked")).toHaveText("Green rice");
  await expect(plan.getByRole("checkbox", { name: "Grandma" })).toBeChecked();
  await expect(plan.getByRole("checkbox", { name: "Mom" })).toBeChecked();
  await shot(page, info, "plan-for-group", "Plan for the group: one meal, a day and a slot, everyone ticked");
  await plan.getByTestId("plan-group-submit").click();
  await expect(page.getByTestId("group-note")).toContainText("Planned Green rice for 2 people.");
  await expect(page.getByTestId("pending-member")).toHaveCount(0);

  // It shows on Grandma's own plan as planned by Mom, never as eaten.
  await grandma.goto("/#/meals");
  await grandma.reload();
  await expect(grandma.getByTestId("planned-by").first()).toContainText("Planned by Mom");
  await shot(grandma, info, "member-planned-by-admin", "Member's plan: the group meal, marked as planned by Mom");
  await context.close();

  // Mom's Plan button opens the same sheet, and planning again skips anyone who already has it.
  await page.getByTestId("plan-group-open").click();
  const again = page.getByRole("dialog", { name: "Plan a meal for The Okafors" });
  await again.getByLabel("Recipe", { exact: true }).selectOption({ label: "Green rice" });
  await again.getByTestId("plan-group-submit").click();
  await expect(page.getByTestId("group-note")).toContainText("2 people already had it.");
});
