import { defineConfig } from "vitest/config";

const testEnv = {
  APP_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://betterplate:betterplate@localhost:5432/betterplate_test",
  PUBLIC_APP_URL: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  API_CORS_ALLOWED_ORIGINS: "http://localhost:3000",
  SESSION_SECRET: process.env.TEST_SESSION_SECRET ?? "test-only-secret-not-used-anywhere-else-0123456789",
  BETTERPLATE_SKIP_ENV_FILE: "1",
  RATE_LIMIT_MULTIPLIER: "50",
  FEATURE_AI_COMPANION_ENABLED: "true",
  // Photo search goes to a local stand-in (scripts/mock-openverse.mjs), started by the tests.
  OPENVERSE_API_URL: "http://localhost:4191",
  // Fake OAuth client: tests check the redirect to Google, never call Google.
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-google-secret",
};
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
