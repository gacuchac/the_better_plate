import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth.ts";
import { config } from "./config.ts";
import { ApiError, type AppEnv, csrfMiddleware, errorBody, sessionMiddleware } from "./lib/http.ts";
import { accountRoutes, devRoutes, healthRoutes } from "./modules/account.ts";
import { catalogRoutes } from "./modules/catalog.ts";
import { recipeRoutes } from "./modules/recipes.ts";
import { syncRoutes } from "./modules/sync.ts";

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
  app.use("*", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json(errorBody(c as never, "payload_too_large", "Request body is too large"), 413) }));
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    if (config.appEnv !== "test") {
      // Structured access log; no bodies, cookies or query values that might identify people.
      console.info(JSON.stringify({ level: "info", msg: "request", method: c.req.method, route: c.req.routePath, status: c.res.status, ms: Math.round(performance.now() - started), requestId: c.get("requestId") }));
    }
  });

  // Better Auth owns /v1/auth/* (email one-time codes, sessions, sign-out).
  app.on(["GET", "POST"], "/v1/auth/*", (c) => auth.handler(c.req.raw));

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
  app.route("/", syncRoutes);
  app.route("/", accountRoutes);
  app.route("/", devRoutes);

  app.doc31("/v1/openapi.json", openApiInfo);

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
