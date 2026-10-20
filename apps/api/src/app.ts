import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_BASE64 } from "@betterplate/contracts";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import { auth } from "./auth.ts";
import { REPO_ROOT, config } from "./config.ts";
import { ApiError, type AppEnv, csrfMiddleware, errorBody, sessionMiddleware } from "./lib/http.ts";
import { accountRoutes, devRoutes, healthRoutes } from "./modules/account.ts";
import { catalogRoutes } from "./modules/catalog.ts";
import { recipeRoutes } from "./modules/recipes.ts";
import { feedbackRoutes } from "./modules/feedback.ts";
import { mealRoutes } from "./modules/meals.ts";
import { sharePageRoutes, shareRoutes } from "./modules/shares.ts";
import { syncRoutes } from "./modules/sync.ts";
import { aiRoutes, MAX_TURN_BYTES } from "./modules/ai/routes.ts";
import { imageRoutes } from "./modules/images.ts";
import { connectorRoutes } from "./modules/connector.ts";

export const API_VERSION = "0.1.0";

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        return c.json(errorBody(c as never, "invalid_request", "The request is not valid", issues), 400);
      }
    },
  });

  app.use("*", requestId({ headerName: "X-Request-Id" }));
  app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-site" }));
  app.use(
    "*",
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "If-Match", "If-None-Match", "X-Request-Id"],
      exposeHeaders: ["ETag", "X-Request-Id", "Retry-After"],
      maxAge: 600,
    }),
  );
  const tooLarge = (c: Parameters<typeof errorBody>[0]) => c.json(errorBody(c, "payload_too_large", "Request body is too large"), 413);
  const defaultLimit = bodyLimit({ maxSize: 512 * 1024, onError: (c) => tooLarge(c as never) });
  // The companion sends its conversation back each step, so that one route takes more.
  const turnLimit = bodyLimit({ maxSize: MAX_TURN_BYTES, onError: (c) => tooLarge(c as never) });
  // Photo uploads arrive as base64, from the app or from a connected assistant over /mcp.
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BASE64 + 64 * 1024, onError: (c) => tooLarge(c as never) });
  app.use("*", (c, next) =>
    c.req.path === "/v1/ai/turn" ? turnLimit(c, next) : c.req.path === "/v1/images/upload" || c.req.path === "/mcp" ? uploadLimit(c, next) : defaultLimit(c, next),
  );
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    if (config.appEnv !== "test") {
      // Structured access log; no bodies, cookies or query values that might identify people.
      console.info(JSON.stringify({ level: "info", msg: "request", method: c.req.method, route: c.req.routePath, status: c.res.status, ms: Math.round(performance.now() - started), requestId: c.get("requestId") }));
    }
  });

  // Claude/ChatGPT connector: MCP endpoint, OAuth discovery documents, and the flag gate for
  // the OAuth provider's /v1/auth/oauth2/* routes (ADR-007). Before Better Auth's handler.
  app.route("/", connectorRoutes);

  // Better Auth owns /v1/auth/* (email one-time codes, sessions, sign-out, connector sign-in).
  app.on(["GET", "POST"], "/v1/auth/*", async (c) => {
    // Post-sign-in redirects may only return to our own app (no open redirect via the OAuth flow).
    if (c.req.method === "POST" && c.req.path === "/v1/auth/sign-in/social") {
      const body = (await c.req.raw.clone().json().catch(() => ({}))) as Record<string, unknown>;
      for (const key of ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]) {
        const value = body[key];
        if (value === undefined) continue;
        const origin = typeof value === "string" && URL.canParse(value) ? new URL(value).origin : null;
        if (!origin || !config.corsOrigins.includes(origin)) throw new ApiError(403, "redirect_not_allowed", `${key} must point to this app`);
      }
    }
    return auth.handler(c.req.raw);
  });

  app.use("/v1/*", csrfMiddleware);
  app.use("/v1/*", sessionMiddleware);

  // Unreleased chef commerce: rejected server-side unless explicitly enabled (never in production).
  app.all("/v1/chef/*", (c) => {
    if (!config.features.chef) throw new ApiError(404, "feature_disabled", "This feature is not available");
    throw new ApiError(404, "not_found", "Not found");
  });

  app.route("/", healthRoutes);
  app.route("/", catalogRoutes);
  app.route("/", recipeRoutes);
  app.route("/", feedbackRoutes);
  app.route("/", mealRoutes);
  app.route("/", shareRoutes);
  app.route("/", syncRoutes);
  app.route("/", aiRoutes);
  app.route("/", imageRoutes);
  app.route("/", accountRoutes);
  app.route("/", devRoutes);

  app.doc31("/v1/openapi.json", openApiInfo);
  app.route("/", sharePageRoutes);

  // Single-service hosting (ADR-001): the API also serves the built PWA from the same origin,
  // so session cookies stay first-party. Locally the web app runs on its own port instead.
  if (config.serveWeb) {
    const root = path.relative(process.cwd(), path.join(REPO_ROOT, "apps/web/dist"));
    if (!existsSync(path.join(root, "index.html"))) throw new Error("SERVE_WEB=true but apps/web/dist is not built");
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/v1/")) return next();
      await next();
      // Hashed assets never change; everything else (index.html, sw.js, manifest) must revalidate.
      c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    });
    app.use("*", async (c, next) => (c.req.path.startsWith("/v1/") ? next() : serveStatic({ root })(c, next)));
    app.get("*", async (c, next) => (c.req.path.startsWith("/v1/") ? next() : serveStatic({ root, path: "index.html" })(c, next)));
  }

  app.notFound((c) => c.json(errorBody(c, "not_found", "Not found"), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(c, err.code, err.message, err.details), err.status);
    if (err instanceof HTTPException) return c.json(errorBody(c, "http_error", err.message), err.status);
    console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId: c.get("requestId"), error: err.message, stack: config.isLocal ? err.stack : undefined }));
    return c.json(errorBody(c, "internal_error", "Something went wrong on our side"), 500);
  });

  return app;
}

export const openApiInfo = {
  openapi: "3.1.0",
  info: {
    title: "The Better Plate API",
    version: API_VERSION,
    description:
      "Versioned REST API for The Better Plate. Authentication uses session cookies issued by /v1/auth " +
      "(email one-time code: POST /v1/auth/email-otp/send-verification-otp, then POST /v1/auth/sign-in/email-otp). " +
      "Nutrition values are estimates computed from USDA FoodData Central records; not-reported nutrients are never zero.",
  },
  servers: [{ url: config.publicApiUrl }],
};
