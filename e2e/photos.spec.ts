import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Locator } from "@playwright/test";
import { addIngredient, API, expectSynced, newEmail, saveAndSync, shot, signIn, waitForServiceWorker } from "./helpers.ts";

// Photo search runs against a local Openverse stand-in (scripts/mock-openverse.mjs) whose
// fixtures are flat-colour test images, labeled as such; generation uses a fake key.
const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);

/** A plain-colour PNG standing in for a phone photo. */
function testPng(w: number, h: number): Buffer {
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0xc8, 0xb4, 0x8a]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

test("upload your own photo after confirming you may use it; only you see it", async ({ page }, info) => {
  await signIn(page, newEmail("upload"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Grandma's stew");
  await saveAndSync(page);

  await page.getByRole("button", { name: "Add a photo" }).click();
  const sheet = page.getByRole("dialog", { name: "Recipe photo" });
  const upload = sheet.getByTestId("photo-upload");
  await upload.getByLabel("Photo file").setInputFiles({ name: "stew.png", mimeType: "image/png", buffer: testPng(400, 300) });
  await expect(upload.getByRole("button", { name: "Upload photo" })).toBeDisabled();
  await expect(upload).toContainText("You're responsible for having the rights to it");
  await upload.getByLabel("I took this photo or have the right to use it").check();
  await shot(page, info, "photo-upload", "Upload your own photo: rights confirmation required, private, metadata removed");
  await upload.getByRole("button", { name: "Upload photo" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("photo-credit")).toHaveText("Your photo");
  await expect.poll(() => loaded(page.getByTestId("recipe-photo").locator("img"))).toBe(true);
  await saveAndSync(page);
  const saved = (await (await page.request.get(`${API}/v1/recipes`)).json()).recipes[0];
  expect(saved.image).toMatchObject({ kind: "upload", credit: null });
  await shot(page, info, "photo-uploaded", "Recipe with the person's own photo, credited as theirs");
});

test("find a recipe photo by describing it, with credit; generate one on your key; photos stay offline", async ({ page, context }, info) => {
  await signIn(page, newEmail("photos"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Weeknight chicken");
  await addIngredient(page, "chicken breast raw", "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
  await saveAndSync(page);

  await page.getByRole("button", { name: "Add a photo" }).click();
  const sheet = page.getByRole("dialog", { name: "Recipe photo" });
  await expect(sheet.getByLabel("Describe the photo you want")).toHaveValue("Weeknight chicken");
  await sheet.getByLabel("Describe the photo you want").fill("juicy grilled chicken for a weeknight dinner");
  await sheet.getByRole("button", { name: "Find photos" }).click();
  const results = sheet.getByTestId("photo-result");
  await expect(results.first()).toContainText("grilled chicken breast");
  await expect(sheet).not.toContainText("non-commercial");
  await expect(results.first()).toContainText("CC BY 2.0");
  await shot(page, info, "photo-search", "Photos found from a description: openly licensed only, license and creator on each");
  await results.first().click();
  await expect(sheet).toBeHidden();

  const photo = page.getByTestId("recipe-photo");
  await expect(page.getByTestId("photo-credit")).toContainText("Test fixture: grilled chicken breast by Fixture Photographer, CC BY 2.0, via flickr");
  await expect.poll(() => loaded(photo.locator("img"))).toBe(true);
  await saveAndSync(page);
  const saved = (await (await page.request.get(`${API}/v1/recipes`)).json()).recipes[0];
  expect(saved.image).toMatchObject({ kind: "photo", credit: { license: "by", creator: "Fixture Photographer" } });
  await shot(page, info, "photo-on-recipe", "Recipe photo with its credit line, saved and synced");

  // Generated on the person's own OpenAI key (fake key in local runs), labelled AI-generated.
  expect((await page.request.put(`${API}/v1/ai/credentials/openai`, { data: { apiKey: "fake-local-openai-0000" }, headers: { origin: "http://localhost:3100" } })).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Change photo" }).click();
  await expect(sheet.getByRole("heading", { name: "Or generate one with AI" })).toBeVisible();
  await expect(sheet).toContainText("Uses your OpenAI key if you connected one");
  await sheet.getByRole("button", { name: "Generate image" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("photo-credit")).toContainText("AI-generated");
  await expect(page.getByTestId("photo-credit")).toContainText("not an exact depiction");
  await saveAndSync(page);
  await shot(page, info, "photo-generated", "Generated image labelled AI-generated, model named, not an exact depiction");

  // Kitchen card shows it, and it still shows after an offline reload.
  await page.goto("/#/kitchen");
  const thumb = page.getByTestId("recipe-card").locator("img");
  await expect.poll(() => loaded(thumb)).toBe(true);
  await waitForServiceWorker(page);
  await page.getByTestId("recipe-card").click();
  await expect.poll(() => loaded(page.getByTestId("recipe-photo").locator("img"))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect.poll(() => loaded(page.getByTestId("recipe-photo").locator("img")), { timeout: 15_000 }).toBe(true);
  await shot(page, info, "photo-offline", "Offline reload: recipe image served from this device");
  await context.setOffline(false);
});

test("the companion adds an openly licensed photo and can undo it", async ({ page }, info) => {
  await signIn(page, newEmail("agent-photo"));
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Grilled chicken");
  await addIngredient(page, "chicken breast raw", "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
  await saveAndSync(page);
  expect((await page.request.put(`${API}/v1/ai/credentials/anthropic`, { data: { apiKey: "fake-local-e2e-photo" }, headers: { origin: "http://localhost:3100" } })).status()).toBe(200);
  await page.reload();

  await page.getByTestId("companion-open").click();
  const panel = page.getByTestId("companion");
  await panel.getByLabel("Ask me to build a recipe").fill("Add a photo to my recipe");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel).toContainText("I added an openly licensed photo", { timeout: 20_000 });
  await expect(panel.locator('[data-tool="find_photos"]')).toContainText("Looked for photos of “grilled chicken”");
  const set = panel.locator('[data-tool="set_recipe_photo"]');
  await expect(set).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("photo-credit")).toContainText("CC BY 2.0");
  await shot(page, info, "companion-photo", "Companion found and attached a licensed photo; credit shown, Undo available");
  await set.getByRole("button", { name: "Undo" }).click();
  await expect(set).toHaveAttribute("data-status", "undone");
  await expect(page.getByTestId("recipe-photo")).toHaveCount(0);
  await expectSynced(page);
});
