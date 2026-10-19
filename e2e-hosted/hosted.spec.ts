import { expect, test } from "@playwright/test";
import { shot, waitForServiceWorker } from "../e2e/helpers.ts";

// Checks that need no sign-in. Signed-in journeys run here once email delivery is configured.

test("health, catalog and server-side guards", async ({ request }) => {
  expect((await request.get("/v1/health/live")).status()).toBe(200);
  const ready = await request.get("/v1/health/ready");
  expect(ready.status(), `readiness: ${await ready.text()}`).toBe(200);

  const manifest = await (await request.get("/v1/catalog/manifest")).json();
  expect(manifest.foodCount).toBeGreaterThanOrEqual(7000);

  // Local-only helpers and unreleased features are closed on the hosted stack.
  expect((await request.get("/v1/dev/mailbox?email=a@example.test")).status()).toBe(404);
  const chef = await request.post("/v1/chef/inquiries", { data: {} });
  expect(chef.status()).toBe(404);
  expect((await request.get("/v1/recipes")).status()).toBe(401);

  // Cross-origin writes are refused.
  const forged = await request.post("/v1/sync/batch", { headers: { Origin: "https://evil.example" }, data: {} });
  expect(forged.status()).toBe(403);
});

test("app shell loads over HTTPS and works offline after the first visit", async ({ page, context }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your kitchen, with you everywhere" })).toBeVisible();
  expect(page.url().startsWith(process.env.HOSTED_URL!)).toBe(true);
  await shot(page, info, "hosted-sign-in", "Hosted sign-in screen");

  await waitForServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your kitchen, with you everywhere" })).toBeVisible();
  await shot(page, info, "hosted-offline-shell", "Hosted app shell reloaded with no network");
  await context.setOffline(false);
});
