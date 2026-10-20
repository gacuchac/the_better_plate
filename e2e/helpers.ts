import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

export const API = "http://localhost:4100";
const OUT = process.env.E2E_OUT ?? path.resolve("artifacts/qa/adhoc/local");

/** Screenshot numbers per test, so parallel workers never write the same file. */
const counters = new Map<string, number>();
/** Ordered, named evidence screenshot plus a manifest line describing it. */
export async function shot(page: Page, info: TestInfo, name: string, note = "") {
  const test = info.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const dir = path.join(OUT, "screenshots", info.project.name, test);
  mkdirSync(dir, { recursive: true });
  const n = (counters.get(info.testId) ?? 0) + 1;
  counters.set(info.testId, n);
  const file = path.join(dir, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  appendFileSync(
    path.join(OUT, "screenshots", "manifest.jsonl"),
    JSON.stringify({ project: info.project.name, test: info.title, name, note, file: path.relative(OUT, file), at: new Date().toISOString() }) + "\n",
  );
}

export const newEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

export async function readCode(request: APIRequestContext, email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${API}/v1/dev/mailbox?email=${encodeURIComponent(email)}`);
    const { messages } = await res.json();
    const code = /code: (\d{6})/.exec(messages[0]?.subject ?? "")?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sign-in code for ${email}`);
}

export async function signIn(page: Page, email: string, info?: TestInfo) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cook what you love, know what's in it" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  if (info) await shot(page, info, "sign-in", "Sign-in screen: email only, adults-only note");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();
  await page.getByLabel("Code").fill(await readCode(page.request, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await acceptPrivacyNotice(page, info);
  await expect(page.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();
  await expect(page.getByTestId("catalog-status")).toContainText("USDA foods saved on this device");
}

export async function addIngredient(page: Page, search: string, exact: string) {
  await page.getByRole("button", { name: "Add ingredient" }).click();
  const dialog = page.getByRole("dialog", { name: "Add ingredient" });
  await dialog.getByLabel("Search foods").fill(search);
  await dialog.getByRole("list", { name: "Foods" }).getByRole("button", { name: new RegExp(`^${exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
  await expect(dialog).toBeHidden();
}

/** Clicks Save, waits for the local save, then for the server acknowledgement. */
export async function saveAndSync(page: Page) {
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByTestId("save-message")).toBeVisible();
  await expect(page.getByTestId("sync-status")).not.toHaveText("Synced");
  await expectSynced(page);
}

export async function expectSynced(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveText("Synced", { timeout: 15_000 });
}

/** Waits until the service worker controls the page, so a reload works offline. */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active) && Boolean(navigator.serviceWorker.controller);
  }, null, { timeout: 15_000 }).catch(async () => {
    // First load installs the worker; a reload puts the page under its control.
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15_000 });
  });
}

/** New accounts agree to the current privacy notice once, confirming they are adults. */
export async function acceptPrivacyNotice(page: Page, info?: TestInfo) {
  const consent = page.getByTestId("consent-screen");
  // An account that already agreed (for example on another device) goes straight to the kitchen.
  await expect(consent.or(page.getByRole("heading", { name: "Recipes", exact: true }))).toBeVisible();
  if (!(await consent.isVisible())) return;
  await expect(consent.getByRole("button", { name: "Agree and continue" })).toBeDisabled();
  await consent.getByLabel("I'm 18 or older").check();
  if (info) await shot(page, info, "privacy-consent", "First sign-in: plain-language privacy notice, adult confirmation");
  await consent.getByRole("button", { name: "Agree and continue" }).click();
}
