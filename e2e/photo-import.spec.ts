import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { API, expectSynced, newEmail, saveAndSync, shot, signIn } from "./helpers.ts";

// The fake model reads every photo as the same labelled test fixture ("Test fixture: lemon
// chicken with rice", see apps/api/src/modules/ai/fake-vision.ts): five lines that match USDA
// foods, one of them with no amount ("Salt to taste"), and one that matches nothing.

/** A plain page-coloured PNG standing in for a photo of a cookbook page. */
function pagePng(w: number, h: number): Buffer {
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0xf6, 0xf1, 0xe4]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

test("reads a recipe from a photo, makes you fix what it couldn't tell, and saves it as your recipe", async ({ page }, info) => {
  await signIn(page, newEmail("import"));
  expect((await page.request.put(`${API}/v1/ai/credentials/openai`, { data: { apiKey: "fake-local-openai-import" }, headers: { origin: "http://localhost:3100" } })).status()).toBe(200);
  await page.getByRole("button", { name: "New recipe" }).click();
  await expect(page.getByTestId("import-offer")).toBeVisible();
  await shot(page, info, "import-offer", "New recipe: offer to read it from a photo");
  await page.getByTestId("import-offer").getByRole("button", { name: "From a photo" }).click();

  const sheet = page.getByRole("dialog", { name: "From a photo" });
  await sheet.getByLabel("Photos (up to 4)").setInputFiles([
    { name: "page-1.png", mimeType: "image/png", buffer: pagePng(600, 800) },
    { name: "page-2.png", mimeType: "image/png", buffer: pagePng(600, 800) },
  ]);
  await expect(sheet).toContainText("2 photos chosen");
  await expect(sheet.getByRole("button", { name: "Read the recipe" })).toBeDisabled();
  await sheet.getByLabel("I took these photos and may use this recipe for my own cooking").check();
  await shot(page, info, "import-pick", "Pick up to four photos and confirm you may use the recipe; photos are not kept");
  await sheet.getByRole("button", { name: "Read the recipe" }).click();

  const review = page.getByRole("dialog", { name: "Check what was read" });
  await expect(review.getByTestId("import-line")).toHaveCount(6);
  await expect(review).toContainText("2 lines need a food or an amount");
  await expect(review.getByTestId("import-use")).toBeDisabled();
  await shot(page, info, "import-review", "Review: each printed line with its USDA match and amount; two lines need fixing");

  // "Salt to taste" has a food but no amount: give it one. "Moon dust" matches nothing: leave it out.
  const salt = review.getByTestId("import-line").filter({ hasText: "Salt to taste" });
  await expect(salt).toHaveAttribute("data-issue", "amount");
  await salt.getByLabel("Amount").fill("2");
  await expect(salt).toHaveAttribute("data-issue", "none");
  const dust = review.getByTestId("import-line").filter({ hasText: "moon dust" });
  await expect(dust).toHaveAttribute("data-issue", "food");
  await dust.getByRole("button", { name: "Leave this line out" }).click();
  await expect(review).toContainText("Every line has a food and an amount");
  await shot(page, info, "import-fixed", "Every kept line has a food and an amount");
  await review.getByTestId("import-use").click();
  await expect(review).toBeHidden();

  await expect(page.getByLabel("Recipe name")).toHaveValue("Test fixture: lemon chicken with rice");
  await expect(page.getByTestId("ingredient-row")).toHaveCount(5);
  await expect(page.getByTestId("import-origin")).toContainText("the method is the book's words");
  await expect(page.getByLabel("Method")).toHaveValue(/74 °C/);
  await shot(page, info, "import-in-editor", "The read recipe in the editor, marked as read from a photo, with its estimate");
  await saveAndSync(page);
  await expectSynced(page);

  const saved = (await (await page.request.get(`${API}/v1/recipes`)).json()).recipes[0];
  expect(saved).toMatchObject({ title: "Test fixture: lemon chicken with rice", servings: 4, origin: { kind: "photo" } });
  expect(saved.ingredients).toHaveLength(5);
  // The photos themselves were never stored.
  expect(saved.image).toBeNull();
});
