import { expect, test, type Page } from "@playwright/test";
import { API, newEmail, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";
const KALE = "Kale, raw";

const localDay = (page: Page, offset: number) =>
  page.evaluate((o) => {
    const d = new Date();
    d.setDate(d.getDate() + o);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, offset);

async function foodId(page: Page, description: string) {
  return ((await (await page.request.get(`${API}/v1/foods?query=${encodeURIComponent(description)}&limit=1`)).json()) as { foods: { id: string }[] }).foods[0]!.id;
}

// Shared milestones: the app suggests a small step from the person's own meals, they share it with
// one tap after a one-time explanation, someone else cheers it with a preset reaction (no comments),
// and only the author sees how many cheers it got. Nobody sees names, meals or amounts.
test("milestones: suggest a small step, share it, someone cheers it, only the author sees the count", async ({ page, browser }, info) => {
  await signIn(page, newEmail("milestone"));
  const [tenAgo, today] = [await localDay(page, -10), await localDay(page, 0)];
  const [rice, kale] = [await foodId(page, RICE), await foodId(page, KALE)];
  const meal = (localDate: string, foods: string[]) => ({
    opId: crypto.randomUUID(), type: "log.create", entityId: crypto.randomUUID(),
    body: {
      plannedMealId: null, recipeId: crypto.randomUUID(), servings: 1, slot: "lunch", localDate, eatenAt: `${localDate}T12:00:00Z`,
      recipe: { title: "Bowl", servings: 1, ingredients: foods.map((foodId) => ({ id: crypto.randomUUID(), foodId, quantity: 100, unit: "g", role: "ingredient" })) },
    },
  });
  // Rice eaten before this week, kale for the first time today.
  const seeded = await page.request.post(`${API}/v1/sync/batch`, {
    headers: { origin: new URL(page.url()).origin },
    data: { protocol: 1, operations: [meal(tenAgo, [rice]), meal(today, [rice, kale])] },
  });
  expect(seeded.ok()).toBe(true);
  await page.goto("/#/kitchen");
  await page.reload();

  const card = page.getByTestId("milestone-card");
  await expect(card).toContainText("You tried something new this week: Kale");
  // The card sits with the day's plan, above "Let's cook something".
  const [cardBox, cookBox] = [await card.boundingBox(), await page.getByTestId("cook-section").boundingBox()];
  expect(cardBox && cookBox && cardBox.y < cookBox.y).toBe(true);
  await shot(page, info, "milestone-card", "Home: one suggested small step with Share and Not now");

  await card.getByRole("button", { name: "Share" }).click();
  const sheet = page.getByRole("dialog", { name: "Share with the community" });
  await expect(sheet.getByTestId("milestone-preview")).toHaveText("Tried something new: Kale");
  await expect(sheet).toContainText("Never your name, email, meals or amounts");
  await shot(page, info, "milestone-explain", "First share only: exactly what others see, and what they never see");
  await sheet.getByRole("button", { name: "Share" }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toContainText("Shared. Cheers show up on your milestones.");

  // Someone else cheers it from the cheers page.
  const other = await browser.newContext();
  const reader = await other.newPage();
  await signIn(reader, newEmail("cheerer"));
  await reader.getByTestId("cheer-others-card").click();
  await expect(reader.getByTestId("cheers-page")).toBeVisible();
  const posts = reader.getByTestId("milestone-post").filter({ hasText: "Tried something new: Kale" });
  await expect(posts.first()).toBeVisible();
  await expect(reader.getByTestId("cheers-page")).not.toContainText("@example.test");
  await expect(posts.first()).not.toContainText(/\d+ cheers?/);
  await shot(reader, info, "cheers-page", "Cheers: others' small steps with three preset reactions, no comments, no counts, no names");
  // Other test runs may have shared kale too: cheer every one so this author's is among them.
  for (let i = 0; i < (await posts.count()); i++) {
    const button = posts.nth(i).getByRole("button", { name: "Well done" });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await other.close();

  await page.goto("/#/cheers");
  const mine = page.getByTestId("my-milestone").filter({ hasText: "Tried something new: Kale" });
  await expect(mine.getByTestId("my-milestone-cheers")).toHaveText(/^\d+ cheers?$/);
  await shot(page, info, "my-cheers", "The author's own milestone with its cheer count, which only they see");
  await mine.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByTestId("my-milestone")).toHaveCount(0);
});
