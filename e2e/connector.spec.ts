import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { acceptPrivacyNotice, API, newEmail, readCode, shot } from "./helpers.ts";

// Claude or ChatGPT connecting to a kitchen: the assistant registers itself, sends the person to
// authorize, they sign in and approve on our consent screen, and it gets a code back. The
// assistant's callback is intercepted; nothing leaves the machine.
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

test("a person signs in, approves an assistant, then disconnects it", async ({ page }, info) => {
  const reg = await page.request.post(`${API}/v1/auth/oauth2/register`, {
    data: { client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  expect(reg.status()).toBe(201);
  const clientId = (await reg.json()).client_id as string;

  let callback: URL | null = null;
  await page.route(`${CALLBACK}**`, async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Back in the assistant</p>" });
  });

  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope: "kitchen:read kitchen:write offline_access",
    state: "e2e-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${API}/mcp`,
  });
  await page.goto(`${API}/v1/auth/oauth2/authorize?${params}`);

  // Not signed in yet: the normal sign-in screen, then straight on to the consent screen.
  const email = newEmail("connector");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await readCode(page.request, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await acceptPrivacyNotice(page);

  const consent = page.getByTestId("connect-consent");
  await expect(consent.getByRole("heading", { name: "Let Claude use your kitchen?" })).toBeVisible();
  await expect(consent.getByTestId("connect-redirect")).toContainText("claude.ai");
  await expect(consent).toContainText("Create and change recipes, plan meals and log what you ate");
  await expect(consent).toContainText("It can't see your email, your API keys");
  await shot(page, info, "connect-consent", "Consent screen: which assistant, where it returns, what it can and can't do");
  await consent.getByRole("button", { name: "Allow" }).click();

  await expect.poll(() => callback?.searchParams.get("state") ?? null).toBe("e2e-state");
  expect(callback!.searchParams.get("code")).toBeTruthy();

  // The connection shows under AI settings and can be removed there.
  await page.goto("/#/ai");
  const apps = page.getByTestId("connected-apps");
  await expect(apps.getByTestId("connector-url")).toHaveText(`${API}/mcp`);
  await expect(apps.getByTestId("connected-app")).toContainText("Claude");
  await shot(page, info, "connected-apps", "AI settings: connected apps with the connector address and Disconnect");
  await apps.getByRole("button", { name: "Disconnect" }).click();
  await expect(apps).toContainText("Nothing is connected.");
});

test("cancelling sends the assistant back without access", async ({ page }) => {
  const reg = await page.request.post(`${API}/v1/auth/oauth2/register`, {
    data: { client_name: "Some assistant", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" },
  });
  const clientId = (await reg.json()).client_id as string;
  let callback: URL | null = null;
  await page.route(`${CALLBACK}**`, async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Back</p>" });
  });

  const email = newEmail("connector-cancel");
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await readCode(page.request, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await acceptPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope: "kitchen:read",
    state: "s2",
    code_challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${API}/mcp`,
  });
  await page.goto(`${API}/v1/auth/oauth2/authorize?${params}`);
  const consent = page.getByTestId("connect-consent");
  await expect(consent).toContainText("Read your recipes");
  await expect(consent).not.toContainText("Create and change recipes");
  await consent.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => callback?.searchParams.get("error") ?? null).toBe("access_denied");
  expect(callback!.searchParams.get("code")).toBeNull();
});
