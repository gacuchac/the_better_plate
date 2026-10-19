import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Hosted pass of the two-pass gate: the same browsers against a deployed URL, no local servers.
const BASE = process.env.HOSTED_URL;
if (!BASE) throw new Error("Set HOSTED_URL, e.g. https://thebetterplate-dev.up.railway.app");
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
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
