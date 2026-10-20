import { expect, test } from "@playwright/test";
import { shot, signIn } from "./helpers.ts";

// The included companion runs on the owner's key (a fake key here) for invited accounts only.
// Fixed invited emails, one per project; counts accumulate across runs, so usage is matched loosely.
test("an invited account uses the included companion without its own key", async ({ page }, info) => {
  await signIn(page, `included-${info.project.name}@example.test`);
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByTestId("ai-summary")).toContainText("On (included)");
  await page.getByTestId("ai-summary").getByRole("link", { name: "Manage" }).click();
  const included = page.getByTestId("ai-included");
  await expect(included).toContainText("Included companion");
  await expect(included).toContainText("In use");
  await expect(included).toContainText("go to OpenAI under The Better Plate's account");
  await expect(page.getByTestId("ai-included-usage")).toContainText(/Today: \d+ of 500 requests/);
  await expect(page.getByTestId("ai-included-usage")).toContainText(/Generated photos today: \d+ of 3/);
  await shot(page, info, "ai-included", "AI settings: included companion with its daily limit and where messages go");

  await page.getByTestId("companion-open").click();
  const panel = page.getByTestId("companion");
  await expect(panel.getByTestId("companion-included")).toContainText(/Included with your account: \d+ of 500/);
  await panel.getByLabel("Ask me to build a recipe").fill("Make me a chicken recipe");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel).toContainText("g of protein per serving", { timeout: 20_000 });
  // Same tools as an own key: the companion opens the saved recipe itself.
  await expect(page).toHaveURL(/#\/recipe\/[0-9a-f-]{36}$/);
  await shot(page, info, "companion-included", "Companion answering on the included key, no own key connected");
});

test("an account that isn't invited is told so and can still connect its own key", async ({ page }, info) => {
  await signIn(page, `not-invited-${Date.now()}-${info.project.name}@example.test`);
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByTestId("ai-summary")).toContainText("Off");
  await page.getByTestId("ai-summary").getByRole("link", { name: "Manage" }).click();
  await expect(page.getByTestId("ai-included")).toContainText("isn't available for your account yet");
  await expect(page.getByTestId("ai-provider-openai")).toBeVisible();
});
