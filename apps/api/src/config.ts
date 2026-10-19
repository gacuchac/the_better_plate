import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function findRepoRoot(start: string): string {
  let dir = start;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

/** Works from source (tsx) and from the bundled dist build. */
export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

// Local convenience: load the git-ignored root .env written by scripts/bootstrap.sh.
// Real environment variables always win; deployed environments never use a file.
const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile) && process.env.BETTERPLATE_SKIP_ENV_FILE !== "1") process.loadEnvFile(envFile);

const APP_ENVS = ["local", "test", "dev", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required setting ${name}. Run "pnpm setup" for local development.`);
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Google sign-in is on only when both OAuth client values are set; one without the other is a mistake. */
function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither");
  return { clientId, clientSecret };
}

function loadConfig() {
  const appEnv = (process.env.APP_ENV ?? "local") as AppEnv;
  if (!APP_ENVS.includes(appEnv)) throw new Error(`APP_ENV must be one of ${APP_ENVS.join(", ")}`);
  const isLocal = appEnv === "local" || appEnv === "test";

  const publicAppUrl = required("PUBLIC_APP_URL");
  const publicApiUrl = required("PUBLIC_API_URL");
  const corsOrigins = list(process.env.API_CORS_ALLOWED_ORIGINS);
  if (corsOrigins.length === 0) corsOrigins.push(new URL(publicAppUrl).origin);
  if (corsOrigins.includes("*")) throw new Error("API_CORS_ALLOWED_ORIGINS must list exact origins, not *");

  const sessionSecret = required("SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error("SESSION_SECRET must be at least 32 bytes");
  if (!isLocal && !publicApiUrl.startsWith("https://")) throw new Error("PUBLIC_API_URL must use https outside local");

  if (!["", "resend", "brevo"].includes(process.env.EMAIL_PROVIDER ?? "")) throw new Error("EMAIL_PROVIDER must be resend or brevo");
  if (!isLocal && !(process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER_API_KEY && process.env.AUTH_EMAIL_FROM)) {
    // Boots so health checks work, but sign-in codes cannot be sent until email is configured.
    console.warn(JSON.stringify({ level: "warning", msg: "email not configured: set EMAIL_PROVIDER, EMAIL_PROVIDER_API_KEY and AUTH_EMAIL_FROM" }));
  }

  const chefEnabled = process.env.FEATURE_CHEF_ENABLED === "true";
  if (appEnv === "production" && chefEnabled) throw new Error("FEATURE_CHEF_ENABLED must stay false in production");

  return {
    appEnv,
    isLocal,
    logLevel: process.env.LOG_LEVEL ?? "info",
    port: Number(process.env.PORT || process.env.API_PORT || new URL(publicApiUrl).port || 4000),
    publicAppUrl,
    publicApiUrl,
    corsOrigins,
    databaseUrl: required("DATABASE_URL"),
    sessionSecret,
    usdaApiKey: process.env.USDA_FDC_API_KEY?.trim() || process.env.USDA_API_KEY?.trim() || "DEMO_KEY",
    usdaBaseUrl: process.env.USDA_FDC_API_BASE_URL ?? "https://api.nal.usda.gov/fdc/v1",
    emailFrom: process.env.AUTH_EMAIL_FROM ?? "The Better Plate <no-reply@localhost>",
    emailProviderKey: process.env.EMAIL_PROVIDER_API_KEY ?? "",
    serveWeb: process.env.SERVE_WEB === "true",
    google: googleConfig(),
    emailProvider: (process.env.EMAIL_PROVIDER ?? "") as "" | "resend" | "brevo",
    features: { chef: chefEnabled, aiCompanion: process.env.FEATURE_AI_COMPANION_ENABLED === "true" },
    /** Relaxed limits for automated local/test runs only. */
    rateLimitMultiplier: isLocal ? Number(process.env.RATE_LIMIT_MULTIPLIER ?? 10) : 1,
  };
}

export type Config = ReturnType<typeof loadConfig>;
export const config: Config = loadConfig();
