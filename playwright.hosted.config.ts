import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Hosted pass of the two-pass gate: the same browsers against a deployed URL, no local servers.
const BASE = process.env.HOSTED_URL;
if (!BASE) throw new Error("Set HOSTED_URL, e.g. https://thebetterplate-dev.up.railway.app");
// Signed-in journeys run only when a saved session exists or a code was supplied to make one.
const STATE = path.resolve(".auth/hosted.json");
const signedIn = fs.existsSync(STATE) || !!process.env.HOSTED_CODE;
const OUT = process.env.E2E_OUT ?? path.resolve("artifacts/qa/adhoc/hosted");

export default defineConfig({
  testDir: "e2e-hosted",
  outputDir: path.join(OUT, "test-results"),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(OUT, "report"), open: "never" }],
    ["junit", { outputFile: path.join(OUT, "junit.xml") }],
  ],
  use: { baseURL: BASE, trace: "on", screenshot: "only-on-failure", serviceWorkers: "allow" },
  projects: [
    // Signed-out checks: no session.
    { name: "desktop", testMatch: "hosted.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", testMatch: "hosted.spec.ts", use: { ...devices["Pixel 7"] } },
    ...(signedIn
      ? [
          // One sign-in, then every signed-in journey reuses the saved session.
          { name: "setup", testMatch: "auth.setup.ts", use: { ...devices["Desktop Chrome"] } },
          { name: "desktop-signed-in", testMatch: "signed-in*.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 }, storageState: STATE } },
          { name: "mobile-signed-in", testMatch: "signed-in*.spec.ts", dependencies: ["setup"], use: { ...devices["Pixel 7"], storageState: STATE } },
        ]
      : []),
  ],
});
