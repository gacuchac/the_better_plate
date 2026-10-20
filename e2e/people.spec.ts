import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { addIngredient, API, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

const RICE = "Rice, white, long-grain, regular, enriched, cooked";
const PEANUTS = "Peanuts, all types, raw";
const SPINACH = "Spinach, raw";

async function newRecipe(page: Page, title: string, items: [string, string, number][]) {
  await page.goto("/#/kitchen");
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill(title);
  await page.getByLabel("Servings", { exact: true }).fill("2");
  for (const [search, exact, grams] of items) {
    await addIngredient(page, search, exact);
    const row = page.getByTestId("ingredient-row").filter({ hasText: exact });
    await row.getByLabel("Unit").selectOption("g");
    await row.getByLabel("Amount").fill(String(grams));
  }
  await saveAndSync(page);
}

async function person(browser: Browser, tag: string, info: TestInfo) {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await signIn(page, newEmail(`${tag}-${info.project.name}`));
  return page;
}

test("tell us about allergies, see alerts, say how a meal went, and shop for the week", async ({ page }, info) => {
  await signIn(page, newEmail("prefs"));
  // Always asked, until answered.
  await expect(page.getByTestId("allergy-prompt")).toBeVisible();
  await shot(page, info, "kitchen-allergy-prompt", "Kitchen asks once about food allergies; shopping list and preferences links");
  await page.getByTestId("allergy-prompt").click();
  await expect(page.getByRole("heading", { name: "Food preferences" })).toBeVisible();
  await page.getByRole("button", { name: "Yes, I'll pick them" }).click();
  await expect(page.getByRole("button", { name: "Save preferences" })).toBeDisabled();
  await page.getByLabel("Peanuts").check();
  await page.getByRole("button", { name: "Add" }).nth(1).click();
  const pick = page.getByRole("dialog", { name: "Add a food you'd rather skip" });
  await pick.getByLabel("Search foods").fill("spinach raw");
  await pick.getByRole("list", { name: "Foods" }).getByRole("button", { name: new RegExp(`^${SPINACH}`) }).first().click();
  await expect(page.getByTestId("pref-dislikes-item")).toContainText(SPINACH);
  await page.getByLabel("Notes").fill("No spicy food");
  await shot(page, info, "preferences-form", "Allergies as stated (FDA's nine), likes, dislikes and notes; never inferred");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByTestId("prefs-saved")).toBeVisible();
  await expectSynced(page);
  const { preferences } = await (await page.request.get(`${API}/v1/preferences`)).json();
  expect(preferences[0]).toMatchObject({ allergyAnswer: "listed", allergens: ["peanut"], notes: "No spicy food" });

  await page.goto("/#/kitchen");
  await expect(page.getByTestId("allergy-prompt")).toHaveCount(0);

  // A recipe with peanuts: tagged from ingredient names, with an alert that never blocks.
  await newRecipe(page, "Peanut rice", [["rice white cooked", RICE, 300], ["peanuts raw", PEANUTS, 60], ["spinach raw", SPINACH, 50]]);
  await expect(page.getByTestId("recipe-allergens")).toContainText("Peanuts");
  await expect(page.getByTestId("allergen-alert")).toContainText("you listed as an allergy");
  await shot(page, info, "recipe-allergen-alert", "Recipe tags allergens from ingredient names and alerts on the person's own allergy");

  await page.getByRole("button", { name: "Plan" }).click();
  const plan = page.getByRole("dialog", { name: "Plan this meal" });
  await expect(plan.getByTestId("allergen-alert")).toBeVisible();
  await shot(page, info, "plan-with-alert", "Planning still works; the alert is a reminder, not a block");
  await plan.getByRole("button", { name: "Add to plan" }).click();
  await expect(plan).toBeHidden();
  await page.getByRole("button", { name: "I ate this" }).click();
  await page.getByRole("dialog", { name: "I ate this" }).getByRole("button", { name: "Save as eaten" }).click();
  await expectSynced(page);

  // After eating: how it went, and the spinach goes on the list of foods to skip.
  await page.goto("/#/meals");
  await page.getByTestId("eaten-row").getByRole("button", { name: "How was Peanut rice?" }).click();
  const fb = page.getByRole("dialog", { name: "How was it?" });
  await fb.getByRole("button", { name: "Not for me" }).click();
  await fb.getByLabel("Comment").fill("Didn't like the spinach");
  await fb.getByLabel(SPINACH).check();
  await shot(page, info, "meal-feedback", "Feedback after eating: rating, comment, ingredients not liked");
  await fb.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("feedback-summary")).toContainText("Didn't like the spinach");
  await expectSynced(page);
  const { feedback } = await (await page.request.get(`${API}/v1/meal-feedback`)).json();
  expect(feedback[0]).toMatchObject({ rating: "disliked", comment: "Didn't like the spinach" });
  await shot(page, info, "meals-with-feedback", "Eaten meal shows what was said about it");

  // The week's shopping list, worked out on the device; the server agrees.
  await page.goto("/#/kitchen");
  await page.getByTestId("shopping-link").click();
  await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
  await expect(page.getByTestId("shop-summary")).toContainText("From 1 planned meal");
  const peanuts = page.getByTestId("shopping-item").filter({ hasText: PEANUTS });
  await expect(peanuts).toContainText("30 g");
  await expect(page.getByTestId("shopping-item").filter({ hasText: RICE })).toContainText("cooked weight");
  await peanuts.getByRole("checkbox").check();
  await shot(page, info, "shopping-list", "Shopping list by category, scaled to servings planned; ticked items struck through");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const list = await (await page.request.get(`${API}/v1/shopping-list?from=${today}&to=${today}`)).json();
  expect(list.items.find((i: { description: string }) => i.description === PEANUTS).grams).toBeCloseTo(30, 6);
  await page.reload();
  await expect(page.getByTestId("shopping-item").filter({ hasText: PEANUTS }).getByRole("checkbox")).toBeChecked();
});

test("a family group: admins plan for a member and a child, alerts show, members propose and admins approve", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  // Mom starts the group and adds a child without a login.
  await signIn(page, newEmail("mom"));
  await page.goto("/#/you");
  await page.getByTestId("groups-summary").getByRole("link", { name: "Manage" }).click();
  await page.getByLabel("Group name").fill("The Garcias");
  await page.getByLabel("Your name in the group").fill("Mom");
  await shot(page, info, "groups-start", "Start a group: a name others see, never an email");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "The Garcias" })).toBeVisible();
  await page.getByRole("button", { name: "Add a child" }).click();
  await page.getByRole("dialog", { name: "Add a child" }).getByLabel("Name").fill("Lucy");
  await page.getByRole("dialog", { name: "Add a child" }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("group-member").filter({ hasText: "Lucy" })).toContainText("no login");

  // Single-use invite links: an admin (the nutritionist) and a member (a teen).
  const inviteLink = async (button: string) => {
    await page.getByRole("button", { name: button }).click();
    const link = await page.getByTestId("invite-link").inputValue();
    await page.getByRole("dialog", { name: "Invite link ready" }).getByRole("button", { name: "Close" }).click();
    return link;
  };
  const adminLink = await inviteLink("Invite an admin");
  const memberLink = await inviteLink("Invite a member");
  await shot(page, info, "group-owner", "Owner's view: members, child profile, invite links");

  const nutri = await person(browser, "nutri", info);
  await nutri.goto(adminLink);
  await expect(nutri.getByTestId("invite-preview")).toContainText("Mom invited you to The Garcias as an admin");
  await nutri.getByLabel("Your name in the group").fill("Dr. Lee");
  await shot(nutri, info, "join-as-admin", "Invite preview says what joining means before anyone joins");
  await nutri.getByRole("button", { name: "Join group" }).click();
  await expect(nutri.getByRole("heading", { name: "The Garcias" })).toBeVisible();

  const teen = await person(browser, "teen", info);
  await teen.goto(memberLink);
  await expect(teen.getByTestId("invite-preview")).toContainText("Meals you plan yourself wait for their approval");
  await teen.getByLabel("Your name in the group").fill("Sam");
  await teen.getByRole("button", { name: "Join group" }).click();
  await expect(teen.getByText("Your admins plan meals for you")).toBeVisible();
  // The teen says they're allergic to peanuts.
  await teen.goto("/#/preferences");
  await teen.getByRole("button", { name: "Yes, I'll pick them" }).click();
  await teen.getByLabel("Peanuts").check();
  await teen.getByRole("button", { name: "Save preferences" }).click();
  await expectSynced(teen);

  // The nutritionist adds a recipe to the group and plans it for Sam: an alert, not a block.
  await newRecipe(nutri, "Satay bowl", [["rice white cooked", RICE, 300], ["peanuts raw", PEANUTS, 60]]);
  await nutri.getByRole("button", { name: "Add to a group" }).click();
  await nutri.getByRole("dialog", { name: "Add to a group" }).getByRole("button", { name: "The Garcias" }).click();
  await expect(nutri.getByTestId("group-recipe-banner")).toContainText("Shared with The Garcias");
  await nutri.goto("/#/groups");
  await nutri.getByTestId("group-card").filter({ hasText: "The Garcias" }).click();
  const samWeek = nutri.getByTestId("member-week").filter({ has: nutri.getByRole("heading", { name: "Sam" }) });
  await expect(samWeek).toContainText("Allergies: Peanuts");
  await samWeek.getByRole("button", { name: "Plan" }).click();
  const planSheet = nutri.getByRole("dialog", { name: "Plan a meal for Sam" });
  await expect(planSheet.getByTestId("allergen-alert")).toContainText("which Sam listed as an allergy");
  await shot(nutri, info, "admin-plan-with-alert", "Admin plans for a member; the member's stated allergy shows as an alert");
  await planSheet.getByRole("button", { name: "Add to plan" }).click();
  await expect(samWeek.getByTestId("member-planned")).toContainText("Satay bowl");
  // And for Lucy, the child.
  const lucyWeek = nutri.getByTestId("member-week").filter({ has: nutri.getByRole("heading", { name: "Lucy" }) });
  await lucyWeek.getByRole("button", { name: "Plan" }).click();
  await nutri.getByRole("dialog", { name: "Plan a meal for Lucy" }).getByRole("button", { name: "Lunch" }).click();
  await nutri.getByRole("dialog", { name: "Plan a meal for Lucy" }).getByRole("button", { name: "Add to plan" }).click();
  await expect(lucyWeek.getByTestId("member-planned")).toContainText("Satay bowl");
  await shot(nutri, info, "admin-week", "Admin's week: every member's plans, meals eaten, feedback and allergies");

  // Sam sees the plan, planned by Dr. Lee, and cannot remove it; the group recipe is read-only.
  await teen.goto("/#/meals");
  await teen.getByTestId("sync-status").click();
  const planned = teen.getByTestId("planned-row").filter({ hasText: "Satay bowl" });
  await expect(planned.getByTestId("planned-by")).toHaveText("Planned by Dr. Lee");
  await expect(planned.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await shot(teen, info, "member-meals", "Member's day: the admin's plan, labeled, with no remove button");
  // Sam plans something for themselves: it waits for approval.
  await newRecipe(teen, "Toast", [["rice white cooked", RICE, 100]]);
  await teen.getByRole("button", { name: "Plan" }).click();
  await teen.getByRole("dialog", { name: "Plan this meal" }).getByRole("button", { name: "Breakfast" }).click();
  await teen.getByRole("dialog", { name: "Plan this meal" }).getByRole("button", { name: "Add to plan" }).click();
  await expectSynced(teen);
  await teen.goto("/#/meals");
  await teen.getByTestId("sync-status").click();
  await expect(teen.getByTestId("planned-row").filter({ hasText: "Toast" }).getByTestId("plan-proposed")).toBeVisible();
  await shot(teen, info, "member-proposed", "A member's own plan waits for an admin's approval");

  // Mom approves it; Lucy's plan reaches Mom's kitchen under Lucy, apart from Mom's own.
  await page.reload();
  const samForMom = page.getByTestId("member-week").filter({ has: page.getByRole("heading", { name: "Sam" }) });
  await samForMom.getByTestId("member-planned").filter({ hasText: "Toast" }).getByRole("button", { name: "Approve" }).click();
  await expect(samForMom.getByTestId("member-planned").filter({ hasText: "Toast" })).not.toContainText("Waiting for approval");
  await shot(page, info, "owner-approved", "Owner approved the member's plan");
  await page.goto("/#/meals");
  await page.getByTestId("sync-status").click();
  await expectSynced(page);
  await expect(page.getByTestId("planned-row")).toHaveCount(0);
  await page.getByRole("group", { name: "Whose meals" }).getByRole("button", { name: "Lucy" }).click();
  await expect(page.getByTestId("meals-for")).toContainText("Meals for Lucy");
  await expect(page.getByTestId("planned-row").filter({ hasText: "Satay bowl" })).toBeVisible();
  await shot(page, info, "parent-child-meals", "Parent's Meals for the child profile, kept apart from their own totals");

  await teen.goto("/#/meals");
  await teen.getByTestId("sync-status").click();
  await expectSynced(teen);
  await expect(teen.getByTestId("planned-row").filter({ hasText: "Toast" }).getByTestId("plan-proposed")).toHaveCount(0);

  // The group's shopping list covers everyone's approved plans.
  await page.goto("/#/shopping");
  await page.getByRole("group", { name: "Group shopping lists" }).getByRole("button", { name: "The Garcias" }).click();
  await expect(page.getByTestId("shopping-item").filter({ hasText: PEANUTS })).toBeVisible();
  await shot(page, info, "group-shopping", "Group shopping list from every member's planned meals");
});
