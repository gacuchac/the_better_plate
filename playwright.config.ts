import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { randomBytes } from "node:crypto";

const OUT = process.env.E2E_OUT ?? path.resolve("artifacts/qa/adhoc/local");
const API = "http://localhost:4100";
const WEB = "http://localhost:3100";

const apiEnv = {
  APP_ENV: "test",
  PORT: "4100",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://betterplate:betterplate@localhost:5432/betterplate_e2e",
  PUBLIC_API_URL: API,
  PUBLIC_APP_URL: WEB,
  API_CORS_ALLOWED_ORIGINS: WEB,
  SESSION_SECRET: randomBytes(32).toString("hex"),
  BETTERPLATE_SKIP_ENV_FILE: "1",
  RATE_LIMIT_MULTIPLIER: "50",
  // Companion on with a derived local key; journeys use the scripted fake provider.
  FEATURE_AI_COMPANION_ENABLED: "true",
  FEATURE_MCP_CONNECTOR_ENABLED: "true",
  // Included companion on a fake owner key, only for these two invited test accounts.
  OPENAI_HOUSE_API_KEY: "fake-local-house",
  AI_HOUSE_ALLOWED_EMAILS: "included-desktop@example.test,included-mobile@example.test",
  AI_HOUSE_DAILY_REQUESTS: "500",
  // Photo search goes to a local stand-in with labeled test fixtures.
  OPENVERSE_API_URL: "http://localhost:4197",
  // Fake OAuth client: the journey stops at Google's door (intercepted), never calls Google.
  GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-only-google-secret",
};

export default defineConfig({
  testDir: "e2e",
  outputDir: path.join(OUT, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(OUT, "report"), open: "never" }],
    ["json", { outputFile: path.join(OUT, "results.json") }],
    ["junit", { outputFile: path.join(OUT, "junit.xml") }],
  ],
  use: {
    baseURL: WEB,
    trace: "on",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node scripts/mock-openverse.mjs 4197",
      url: "http://localhost:4197/v1/images/?q=ping",
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: "node apps/api/dist/db/cli.mjs reset && node apps/api/dist/server.mjs",
      url: `${API}/v1/health/ready`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @betterplate/web exec vite preview --outDir dist-e2e --port 3100 --strictPort",
      url: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
