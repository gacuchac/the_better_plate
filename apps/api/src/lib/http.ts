import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth.ts";
import { config } from "../config.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    user: AuthUser | null;
    /** Set on connector (MCP) requests after the access token is verified. */
    connector?: { userId: string; clientId: string; scopes: Set<string> };
  };
};

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 415 | 422 | 428 | 429 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(status, { message });
  }
}

export function errorBody(c: Context<AppEnv>, code: string, message: string, details?: unknown) {
  return { error: { code, message, requestId: c.get("requestId") ?? "unknown", ...(details === undefined ? {} : { details }) } };
}

/** Resolves the Better Auth session (cookie) into c.var.user without failing anonymous requests. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  c.set("user", session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null);
  await next();
};

export function requireUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in to continue");
  return user;
}

/**
 * CSRF defense for cookie-authenticated API calls (auth routes have Better Auth's own checks):
 * unsafe methods must send JSON (forces a CORS preflight cross-site) and, when the browser
 * sends an Origin, it must be an allowed origin. Session cookies are SameSite=Lax.
 */
export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin && !config.corsOrigins.includes(origin)) throw new ApiError(403, "origin_not_allowed", "Request origin is not allowed");
    const length = c.req.header("content-length");
    const hasBody = (length !== undefined && length !== "0") || c.req.header("transfer-encoding") !== undefined;
    if (hasBody && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json");
    }
  }
  await next();
};

/**
 * Fixed-window limiter in process memory. Adequate for the single-instance pilot (ADR-001);
 * replace with a shared store before running more than one API replica.
 */
export function rateLimit(name: string, limit: number, windowSeconds: number): MiddlewareHandler<AppEnv> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const max = Math.round(limit * config.rateLimitMultiplier);
  return async (c, next) => {
    const user = c.get("user");
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const key = user ? `u:${user.id}` : `ip:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
      buckets.set(key, bucket);
      if (buckets.size > 50_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    bucket.count += 1;
    c.header("RateLimit-Limit", String(max));
    c.header("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      throw new ApiError(429, "rate_limited", `Too many ${name} requests; try again shortly`);
    }
    await next();
  };
}
