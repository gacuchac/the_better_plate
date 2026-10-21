import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addIngredient, newEmail, saveAndSync, signIn } from "./helpers.ts";

// WCAG 2.2 A/AA rules that axe can check automatically. Manual review (screen reader passes,
// focus order judgment) is still needed; this catches regressions on every run.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const found: string[] = [];
async function audit(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  found.push(...violations.map((v) => `${screen}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`));
}

test.beforeEach(() => void found.splice(0));

test("core screens have no automatically detectable WCAG 2.2 AA violations", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cook what you love, know what's in it" })).toBeVisible();
  await audit(page, "sign-in");
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { name: "How The Better Plate handles your data" })).toBeVisible();
  await audit(page, "privacy-notice");

  await signIn(page, newEmail("a11y"));
  await audit(page, "kitchen-empty");

  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Accessible rice");
  await addIngredient(page, "rice white cooked", "Rice, white, long-grain, regular, enriched, cooked");
  await addIngredient(page, "olive", "Oil, olive, salad or cooking");
  await page.getByLabel("Method").fill("Warm the rice for 2 minutes.\nStir in the oil.");
  await audit(page, "editor-dirty");
  await saveAndSync(page);
  await audit(page, "editor-saved");
  const recipeUrl = page.url();

  await page.getByRole("button", { name: "Add ingredient" }).click();
  await page.getByRole("dialog", { name: "Add ingredient" }).getByLabel("Search foods").fill("broccoli");
  await audit(page, "food-picker");
  await page.keyboard.press("Escape");

  // Keyboard: the sheet takes focus, Tab stays inside it, Escape returns focus to the opener.
  await page.getByRole("button", { name: "Share recipe" }).focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Share recipe" });
  await expect(sheet).toBeFocused();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Share recipe" })).toBeFocused();
  await page.getByRole("button", { name: "Share recipe" }).click();
  await audit(page, "share-sheet");
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Link", { exact: true }).inputValue();
  await audit(page, "share-created");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Plan" }).click();
  await audit(page, "plan-sheet");
  await page.getByRole("button", { name: "Add to plan" }).click();
  await page.getByRole("button", { name: "I ate this" }).click();
  await audit(page, "log-sheet");
  await page.getByRole("button", { name: "Save as eaten" }).click();

  await page.getByRole("link", { name: "Cook" }).click();
  await audit(page, "cook-start");
  await page.getByRole("button", { name: "Start cooking" }).click();
  await audit(page, "cook-step");
  await page.goto(recipeUrl);

  await page.goto("/#/meals");
  await expect(page.getByTestId("eaten-card")).toBeVisible();
  await audit(page, "meals-day");
  await page.getByRole("tab", { name: "7 days" }).or(page.getByRole("button", { name: "7 days" })).click();
  await audit(page, "meals-week");

  await page.goto("/#/kitchen");
  await expect(page.getByTestId("today-card")).toBeVisible();
  await audit(page, "kitchen-with-recipe");

  await page.goto("/#/explore");
  await page.getByLabel("Search foods").fill("salmon");
  await audit(page, "explore");

  await page.goto("/#/you");
  await audit(page, "you");
  await page.getByTestId("period-totals").getByRole("tab", { name: "Dates" }).click();
  await audit(page, "you-totals-dates");
  await page.goto("/#/goals");
  await page.getByRole("button", { name: "Add a goal" }).click();
  await page.getByRole("dialog", { name: "New goal" }).getByLabel("Goal", { exact: true }).selectOption("between");
  await audit(page, "goal-sheet");
  await page.getByRole("dialog", { name: "New goal" }).getByLabel("From").fill("10");
  await page.getByRole("dialog", { name: "New goal" }).getByLabel("To").fill("20");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByTestId("goal-card")).toBeVisible();
  await audit(page, "goals");
  await page.goto("/#/preferences");
  await page.getByRole("button", { name: "Yes, I'll pick them" }).click();
  await audit(page, "preferences");
  await page.goto("/#/shopping");
  await expect(page.getByTestId("shop-summary")).toBeVisible();
  await audit(page, "shopping-list");
  await page.goto("/#/groups");
  await expect(page.getByRole("link", { name: "Groups", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Group name").fill("Accessible family");
  await page.getByLabel("Your name in the group").fill("Ana");
  await audit(page, "groups");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "Accessible family" })).toBeVisible();
  await expect(page.getByTestId("group-week")).toBeVisible();
  await audit(page, "group");
  await page.goto("/#/you");

  await page.getByRole("button", { name: "Report an issue" }).click();
  await audit(page, "report-sheet");
  await page.keyboard.press("Escape");

  const guest = await browser.newContext();
  const reader = await guest.newPage();
  await reader.goto(url);
  await expect(reader.getByTestId("shared-recipe")).toBeVisible();
  await audit(reader, "shared-recipe");
  await guest.close();
  expect(found, found.join("\n")).toEqual([]);
});
