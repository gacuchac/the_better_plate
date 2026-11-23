import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { addIngredient, API, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

// The fake model reads every receipt photo as the same labelled test fixture ("Test fixture:
// Corner Market", see apps/api/src/modules/ai/fake-vision.ts): five lines, 24.07 before 1.20 tax,
// 25.27 in all, the last line (paper towels) not a food.

const CHICKEN = "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw";
const RICE = "Rice, white, long-grain, regular, enriched, cooked";

function receiptPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0xfb, 0xfb, 0xf7]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

async function openCooking(page: Page) {
  await page.getByRole("navigation", { name: /^(Main|Principal)$/ }).getByRole("link", { name: "You", exact: true }).click();
  await page.getByTestId("cooking-row").click();
}

async function setUpCook(page: Page, info: Parameters<typeof shot>[1]) {
  await openCooking(page);
  await expect(page.getByRole("heading", { name: "Cook for other people" })).toBeVisible();
  await page.getByLabel("Business name (optional)").fill("Test Kitchen");
  await page.getByLabel("Hourly rate").fill("30");
  await shot(page, info, "cook-setup", "Setting up cooking for others: business name, currency (USD by default), hourly rate");
  await page.getByRole("button", { name: "Start cooking for others" }).click();
  await expect(page.getByRole("heading", { name: "Test Kitchen" })).toBeVisible();
}

async function addClient(page: Page, name: string, notes: string) {
  await page.getByRole("tab", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Add a client" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a client" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("Notes, allergies included").fill(notes);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("cook-client-row").filter({ hasText: name })).toBeVisible();
}

async function newRecipe(page: Page) {
  await page.goto("/#/home");
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Chicken and rice");
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await page.getByLabel("Method").fill("1. Cook the rice.\n2. Sear the chicken until it reaches 74 °C inside.\n3. Serve together.");
  await addIngredient(page, "chicken breast raw", CHICKEN);
  const chicken = page.getByTestId("ingredient-row").filter({ hasText: CHICKEN });
  await chicken.getByLabel("Unit").selectOption("g");
  await chicken.getByLabel("Amount").fill("400");
  await addIngredient(page, "rice white cooked", RICE);
  const rice = page.getByTestId("ingredient-row").filter({ hasText: RICE });
  await rice.getByLabel("Unit").selectOption("g");
  await rice.getByLabel("Amount").fill("300");
  await saveAndSync(page);
}

test("a cook cooks for a client, adds a receipt, shares the meal and bills a statement", async ({ page, browser }, info) => {
  await signIn(page, newEmail("cook"));
  expect((await page.request.put(`${API}/v1/ai/credentials/openai`, { data: { apiKey: "fake-local-openai-cook" }, headers: { origin: "http://localhost:3100" } })).status()).toBe(200);
  await setUpCook(page, info);
  await shot(page, info, "cook-meals-empty", "Cooking home: meals, clients, receipts, statements and prices");
  await addClient(page, "Test client Ana", "No peanuts");
  await shot(page, info, "cook-clients", "A client who isn't in the app, with the cook's own notes");

  await newRecipe(page);
  await page.getByTestId("cook-button").click();
  const picker = page.getByRole("dialog", { name: "Who are you cooking for?" });
  await expect(picker.getByTestId("cooking-for").getByRole("button")).toHaveCount(2);
  await picker.getByRole("button", { name: /Test client Ana/ }).click();
  await expect(picker.getByRole("button", { name: /Test client Ana/ })).toContainText("No peanuts");
  await shot(page, info, "cook-picker", "Tapping Cook asks who it's for; a client shows the cook's notes");
  await picker.getByTestId("cooking-start").click();

  await expect(page.getByTestId("cook-mode")).toBeVisible();
  await expect(page.getByTestId("meal-timer")).toContainText("Cooking for Test client Ana");
  await shot(page, info, "cook-mode-meal", "Cook mode with the meal's timer running on top");
  await page.getByTestId("meal-timer-done").click();

  await expect(page.getByTestId("cook-meal")).toBeVisible();
  const mealId = /\/cooking\/meal\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.getByTestId("meal-timer-state")).toHaveText("The cooking timer is stopped.");
  await page.getByLabel("Cooking (min)").fill("60");
  await page.getByRole("button", { name: "Save time" }).click();
  await expect(page.getByTestId("meal-totals")).toContainText("$30.00");
  await page.getByRole("button", { name: "Add a cost" }).click();
  const cost = page.getByRole("dialog", { name: "Add a cost" });
  await cost.getByLabel("What was it?").fill("Parking");
  await cost.getByLabel("Amount").fill("5");
  await cost.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("meal-totals")).toContainText("$5.00");
  await shot(page, info, "cook-meal", "The meal: recipes with ingredient costs, time at the hourly rate, other costs, total");

  // Receipt: photo → check every line → assign to the meal or personal → confirm.
  await page.goto("/#/cooking/receipts");
  await page.getByTestId("receipt-file").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: receiptPng(400, 900) });
  await expect(page.getByTestId("cook-receipt")).toBeVisible();
  const lines = page.getByTestId("receipt-line");
  await expect(lines).toHaveCount(5);
  await expect(page.getByLabel("Store")).toHaveValue("Test fixture: Corner Market");
  await expect(page.getByTestId("receipt-difference")).toHaveText("Lines and tax add up to the total.");
  for (let i = 0; i < 4; i++) await lines.nth(i).getByLabel("Bought for").selectOption(mealId);
  await lines.nth(4).getByLabel("Bought for").selectOption("personal");
  await shot(page, info, "cook-receipt-review", "Receipt read from a photo: each line matched to a food and assigned to the meal or personal");
  await page.getByTestId("receipt-confirm").click();
  await expect(page.getByText("Confirmed. Its lines are on their meals")).toBeVisible();
  await shot(page, info, "cook-receipt-confirmed", "Confirmed receipt: tax spread over the lines, prices updated");

  await page.goto(`/#/cooking/meal/${mealId}`);
  await expect(page.locator("section[aria-labelledby=meal-groceries]")).toContainText("CHICKEN BREAST");
  // 4 food lines with their tax share, +$30 time, +$5 parking.
  const total = await page.getByTestId("meal-total").textContent();
  expect(total).toMatch(/^\$\d+\.\d\d$/);

  // Share the basics and the groceries only, with a link.
  await page.getByTestId("meal-share").click();
  const share = page.getByRole("dialog", { name: "Share this meal" });
  await share.getByLabel("Groceries and what they cost").check();
  await share.getByLabel("Also make a link anyone can open").check();
  await share.getByTestId("share-save").click();
  const link = await share.getByTestId("share-link").getByRole("textbox").inputValue();
  expect(link).toMatch(/#\/cooked\/[0-9a-f-]{36}$/);
  await shot(page, info, "cook-share", "Sharing: basics always, groceries switched on, time and totals off, with a link");
  await share.getByRole("button", { name: "Close" }).click();

  // Statement: add up the meal, mark it sent (frozen).
  await page.goto("/#/cooking/statements");
  await page.getByRole("button", { name: "New statement" }).click();
  const st = page.getByRole("dialog", { name: "New statement" });
  await st.getByLabel("Title").fill("November meals");
  await st.getByTestId("statement-meals").getByRole("checkbox").first().check();
  await st.getByTestId("statement-create").click();
  await expect(page.getByTestId("cook-statement")).toBeVisible();
  await expect(page.getByTestId("statement-total")).toHaveText(total!);
  await page.getByTestId("statement-send").click();
  await expect(page.getByText("This statement is final")).toBeVisible();
  await shot(page, info, "cook-statement", "Statement adding up the meal, marked sent and frozen; print, CSV and share");

  // The link, signed out: basics and groceries, no time or totals.
  const guest = await browser.newContext();
  const pub = await guest.newPage();
  await pub.goto(link);
  await expect(pub.getByTestId("public-cooked")).toContainText("Chicken and rice");
  await expect(pub.getByTestId("shared-cooked-meal")).toContainText("CHICKEN BREAST");
  await expect(pub.getByTestId("shared-cooked-meal")).not.toContainText("Total:");
  await expect(pub.getByTestId("shared-cooked-meal")).not.toContainText("Time:");
  await shot(pub, info, "cook-public-link", "What the link shows: only the parts the cook switched on");
  await guest.close();
});

test("an invited client accepts and sees the meals cooked for them, without prices", async ({ page, browser }, info) => {
  const clientEmail = newEmail("client");
  // The client signs in first, so their account exists to receive the invite.
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await signIn(client, clientEmail);

  await signIn(page, newEmail("cook2"));
  await setUpCook(page, info);
  await addClient(page, "Test client Bo", "");
  await page.getByTestId("cook-client-row").filter({ hasText: "Test client Bo" }).click();
  const sheet = page.getByRole("dialog", { name: "Test client Bo" });
  await sheet.getByLabel("Their email").fill(clientEmail);
  await sheet.getByRole("button", { name: "Send invite" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Invite sent.");
  await shot(page, info, "cook-invite", "Inviting a client by email is optional; nothing is shared until they accept");
  await sheet.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Meals" }).click();
  await page.getByRole("button", { name: "New meal" }).click();
  const nm = page.getByRole("dialog", { name: "New meal" });
  await nm.getByLabel("Meal name").fill("Soup night");
  const bo = await nm.getByLabel("Who are you cooking for?").locator("option", { hasText: "Test client Bo" }).getAttribute("value");
  await nm.getByLabel("Who are you cooking for?").selectOption(bo!);
  await nm.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("cook-meal")).toBeVisible();
  await page.getByLabel("Cooking (min)").fill("90");
  await page.getByRole("button", { name: "Save time" }).click();
  await expect(page.getByTestId("meal-totals")).toContainText("$45.00");

  const mail = await (await page.request.get(`${API}/v1/dev/mailbox?email=${encodeURIComponent(clientEmail)}`)).json();
  expect(mail.messages.some((m: { subject: string }) => m.subject.startsWith("Test Kitchen invited you"))).toBe(true);

  await client.getByRole("navigation", { name: /^(Main|Principal)$/ }).getByRole("link", { name: "You", exact: true }).click();
  await client.getByTestId("my-cooks-row").click();
  await expect(client.getByTestId("cook-invite")).toContainText("Test Kitchen cooks for you");
  await shot(client, info, "client-invite", "The client is asked to accept; they see what accepting shares");
  await client.getByTestId("cook-invite-accept").click();
  await expect(client.getByTestId("my-cooked-meal")).toContainText("Soup night");
  await expect(client.getByTestId("my-cooks")).not.toContainText("$");
  await shot(client, info, "client-history", "After accepting: every meal cooked for them, with no prices unless shared");
  await clientCtx.close();
});
