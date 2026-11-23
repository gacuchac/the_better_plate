import { expect, test } from "@playwright/test";
import { addIngredient, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";

test("an owner shares chosen parts of their account; the other person accepts, works in it and switches back", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const ownerEmail = newEmail(`owner-${info.project.name}`);
  const helperEmail = newEmail(`helper-${info.project.name}`);

  // The helper has an account, so the request reaches them.
  const context = await browser.newContext({ ...info.project.use });
  const helper = await context.newPage();
  await signIn(helper, helperEmail);

  // The owner saves a recipe, then shares recipes (change) and the meal plan (view).
  await signIn(page, ownerEmail);
  await page.goto("/#/create");
  await page.getByLabel("Recipe name").fill("Lentil soup");
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await addIngredient(page, "rice white cooked", RICE);
  await saveAndSync(page);

  await page.goto("/#/you");
  await page.getByTestId("linked-row").click();
  await expect(page.getByRole("heading", { name: "Linked accounts" })).toBeVisible();
  // Everything starts off; nothing can be sent until something is on.
  await expect(page.getByTestId("send-link")).toBeDisabled();
  await page.getByLabel("Their email").fill(helperEmail);
  await page.getByTestId("share-recipes-change").click();
  await page.getByTestId("share-plans-view").click();
  await shot(page, info, "share-form", "Owner picks what to share, one toggle per area");
  await page.getByTestId("send-link").click();
  await expect(page.getByRole("status").filter({ hasText: "Request sent" })).toBeVisible();
  await expect(page.getByTestId("given-link")).toContainText("Waiting for them to accept");

  // The helper sees exactly what is shared and accepts.
  await helper.goto("/#/linked");
  const request = helper.getByTestId("link-request");
  await expect(request).toContainText("Recipes (Change), Meal plan (View)");
  await shot(helper, info, "link-request", "The other person sees what is shared before accepting");
  await request.getByTestId("accept-link").click();
  const usable = helper.getByTestId("received-link");
  await expect(usable).toContainText(ownerEmail);
  await usable.getByTestId("switch-to").click();

  // In the owner's account: a banner says so, the owner's recipe is there, unshared areas say so.
  await expect(helper.getByTestId("acting-banner")).toContainText(`You're in ${ownerEmail}'s account.`);
  await helper.goto("/#/kitchen");
  await expect(helper.getByText("Lentil soup").first()).toBeVisible();
  await expectSynced(helper);
  await shot(helper, info, "acting-kitchen", "Working in the linked account: banner and the owner's recipes");
  await helper.goto("/#/preferences");
  await expect(helper.getByTestId("not-shared")).toContainText("hasn't shared this with you");

  // Back to their own account: the owner's recipe isn't in it.
  await helper.getByTestId("switch-back").click();
  await expect(helper.getByTestId("acting-banner")).toBeHidden();
  await helper.goto("/#/kitchen");
  await expect(helper.getByText("Lentil soup")).toHaveCount(0);

  // The owner sees it in the activity log and can stop sharing.
  await page.reload();
  await expect(page.getByTestId("given-link")).toContainText("Can use your account");
  await expect(page.getByTestId("link-activity-others")).toContainText("Accepted the shared account");
  await shot(page, info, "owner-activity", "Owner sees who can use the account and what was done");
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("end-link").click();
  await expect(page.getByTestId("given-link")).toHaveCount(0);
  await context.close();
});
