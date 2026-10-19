import { expect, test } from "@playwright/test";
import { API, expectSynced, newEmail, shot, signIn } from "./helpers.ts";

// The scripted provider (keys starting "fake-local-", local and test runs only) stands in for
// OpenAI or Anthropic, so this journey drives the real tool loop, stores and screens.
test("the AI companion builds a recipe, logs a meal and asks before deleting, with undo", async ({ page }, info) => {
  await signIn(page, newEmail("agent"));

  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByTestId("ai-summary")).toContainText("Off");
  await page.getByTestId("ai-summary").getByRole("link", { name: "Manage" }).click();
  await expect(page.getByRole("heading", { name: "AI companion" })).toBeVisible();
  const anthropic = page.getByTestId("ai-provider-anthropic");
  await anthropic.getByLabel("Anthropic (Claude) API key").fill("fake-local-e2e-0000");
  await shot(page, info, "ai-settings-connect", "AI settings: bring your own key, privacy note, key field masked");
  await anthropic.getByRole("button", { name: "Check and connect" }).click();
  await expect(anthropic).toContainText("Connected, key ending …0000");
  await expect(anthropic).toContainText("In use");
  await expect(anthropic.getByLabel("Anthropic (Claude) API key")).toHaveCount(0);
  await expect(page.getByTestId("ai-usage")).toContainText("Today: 0 of 200 requests");
  await shot(page, info, "ai-settings-connected", "Connected: only the last four characters shown; model, daily limit, usage");

  // Build a recipe and watch each step; the recipe opens beside the panel.
  await page.getByTestId("companion-open").click();
  const panel = page.getByTestId("companion");
  await expect(panel).toContainText("You can undo anything I save");
  await panel.getByLabel("Ask me to build a recipe").fill("Make me a chicken recipe");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel).toContainText("g of protein per serving", { timeout: 20_000 });
  const create = panel.locator('[data-tool="save_recipe"]');
  await expect(create).toHaveAttribute("data-status", "done");
  await expect(create).toContainText("Companion lemon chicken");
  await expect(panel.locator('[data-tool="search_foods"]')).toContainText("Searched foods for “chicken breast raw”");
  await expect(page).toHaveURL(/#\/recipe\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Recipe name")).toHaveValue("Companion lemon chicken");
  await expect(panel).not.toContainText("NaN");
  await shot(page, info, "companion-built-recipe", "Companion: live steps (search, create, open) and the recipe open beside the chat");

  // Undo removes what the agent made.
  await create.getByRole("button", { name: "Undo" }).click();
  await expect(create).toHaveAttribute("data-status", "undone");
  await page.evaluate(() => (location.hash = "#/kitchen"));
  await expect(page.getByRole("link", { name: /Companion lemon chicken/ })).toHaveCount(0);
  await shot(page, info, "companion-undone", "Undo: the recipe is gone and the step is struck through");

  // Again, then log it as eaten.
  await panel.getByLabel("Ask me to build a recipe").fill("Another recipe please");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.locator('[data-tool="save_recipe"][data-status="done"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible();
  await panel.getByLabel("Ask me to build a recipe").fill("I ate it for lunch");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel).toContainText("Logged one serving as eaten", { timeout: 20_000 });
  await expect(page).toHaveURL(/#\/meals\/\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId("eaten-row")).toHaveCount(1);
  await expectSynced(page);
  await shot(page, info, "companion-logged-meal", "Companion marked a meal as eaten; the day view shows it");

  // Deleting waits for the person's tap; "Keep it" leaves the recipe alone.
  await panel.getByLabel("Ask me to build a recipe").fill("delete it");
  await panel.getByRole("button", { name: "Send" }).click();
  const del = panel.locator('[data-tool="delete_recipe"]').last();
  await expect(del).toHaveAttribute("data-status", "waiting", { timeout: 20_000 });
  await expect(del).toContainText("Companion lemon chicken");
  await shot(page, info, "companion-confirm-delete", "Deleting asks first: Delete or Keep it");
  await del.getByRole("button", { name: "Keep it" }).click();
  await expect(panel).toContainText("Okay, I kept it.");
  await expect(del).toHaveAttribute("data-status", "declined");

  await panel.getByLabel("Ask me to build a recipe").fill("delete it");
  await panel.getByRole("button", { name: "Send" }).click();
  const del2 = panel.locator('[data-tool="delete_recipe"]').last();
  await expect(del2).toHaveAttribute("data-status", "waiting", { timeout: 20_000 });
  await del2.getByRole("button", { name: "Delete" }).click();
  await expect(panel).toContainText("Deleted.");
  await expectSynced(page);
  const recipes = await (await page.request.get(`${API}/v1/recipes`)).json();
  expect(recipes.recipes).toHaveLength(0);

  // Usage is counted per request; the key never reaches the browser.
  await page.goto("/#/ai");
  await expect(page.getByTestId("ai-usage")).not.toContainText("Today: 0 of");
  const html = await page.content();
  expect(html).not.toContain("fake-local-e2e-0000");
});
