import fs from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { acceptPrivacyNotice } from "../e2e/helpers.ts";

/** Where the saved session lives. It is a live login cookie: gitignored, kept on the machine that ran this. */
export const STATE = path.resolve(".auth/hosted.json");

// Signs in once and saves the session so every signed-in hosted journey reuses it. The one-time code
// arrives by real email: HOSTED_EMAIL is the test account, HOSTED_CODE its code (run once without
// HOSTED_CODE and a code is sent). A saved session that still works is reused, so no code is needed.
setup("sign in once and save the session", async ({ browser, page }) => {
  const base = process.env.HOSTED_URL!;
  // The deployed app serves web and API from one origin; HOSTED_API_URL is only for rehearsing on a local stack.
  const api = process.env.HOSTED_API_URL ?? base;
  if (fs.existsSync(STATE)) {
    const saved = await browser.newContext({ storageState: STATE, baseURL: base });
    const me = await saved.request.get(`${api}/v1/me`);
    await saved.close();
    if (me.ok()) return;
  }

  const email = process.env.HOSTED_EMAIL;
  const code = process.env.HOSTED_CODE;
  if (!email) throw new Error("No saved session. Set HOSTED_EMAIL to the test account's email.");
  if (!code) {
    const sent = await page.request.post(`${api}/v1/auth/email-otp/send-verification-otp`, { data: { email, type: "sign-in" }, headers: { Origin: base } });
    throw new Error(`No saved session. A sign-in code was ${sent.ok() ? "sent" : `NOT sent (${sent.status()})`} to ${email}. Run again with HOSTED_CODE=<code>.`);
  }

  const signedIn = await page.request.post(`${api}/v1/auth/sign-in/email-otp`, { data: { email, otp: code }, headers: { Origin: base } });
  expect(signedIn.ok(), `sign-in: ${signedIn.status()}`).toBe(true);
  await page.goto("/");
  await acceptPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();
  await expect(page.getByTestId("catalog-status")).toContainText("USDA foods saved on this device");
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE, indexedDB: true });
});
