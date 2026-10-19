import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit } from "../lib/http.ts";
import { ErrorResponses } from "./common.ts";

/** ~300 KB of image once base64-decoded keeps the whole request under the 512 KB body limit. */
const MAX_SCREENSHOT_BYTES = 300 * 1024;

const FeedbackSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["bug", "feedback", "suggestion"]),
    message: z.string().trim().min(1, "Tell us what happened").max(4000),
    activity: z.array(z.object({ at: z.iso.datetime(), event: z.string().trim().min(1).max(160) })).max(30),
    context: z.object({
      route: z.string().max(200),
      appVersion: z.string().max(64),
      deviceClass: z.enum(["phone", "tablet", "desktop"]),
      online: z.boolean(),
      requestIds: z.array(z.string().max(64)).max(10),
      error: z.object({ message: z.string().max(500), stack: z.string().max(2000).optional() }).nullable(),
    }),
    /** data:image/jpeg|png;base64,... — only sent after the person previewed it. */
    screenshot: z.string().max(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 40).nullable(),
  })
  .openapi("FeedbackReport");

const FeedbackReceiptSchema = z.object({ id: z.uuid(), receivedAt: z.string(), duplicate: z.boolean() }).openapi("FeedbackReceipt");

// Defense in depth: drop anything that looks like a credential before storing.
const SECRETS = [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g];
export const redact = (text: string) => SECRETS.reduce((t, re) => t.replace(re, "[removed]"), text);

function decodeScreenshot(dataUrl: string): { type: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ApiError(400, "invalid_screenshot", "Screenshot must be a JPEG or PNG data URL");
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_SCREENSHOT_BYTES) throw new ApiError(413, "screenshot_too_large", "Screenshot is too large");
  const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if ((m[1] === "image/png" && !png) || (m[1] === "image/jpeg" && !jpeg)) throw new ApiError(400, "invalid_screenshot", "Screenshot content does not match its type");
  return { type: m[1]!, bytes };
}

export const feedbackRoutes = new OpenAPIHono<AppEnv>();
feedbackRoutes.use("/v1/feedback", rateLimit("feedback", 20, 3600));

feedbackRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/feedback", tags: ["feedback"],
    summary: "Send an issue report (signed in or not)",
    description:
      "Available on every screen, including sign-in and error states. The client shows the person exactly what is sent " +
      "(message, readable recent steps, optional screenshot preview) before submitting. `id` makes retries from the offline queue idempotent.",
    request: { body: { required: true, content: { "application/json": { schema: FeedbackSchema } } } },
    responses: {
      201: { description: "Stored", content: { "application/json": { schema: FeedbackReceiptSchema } } },
      200: { description: "Already received (same id)", content: { "application/json": { schema: FeedbackReceiptSchema } } },
      413: { description: "Screenshot too large", content: { "application/json": { schema: z.object({ error: z.any() }) } } },
      ...ErrorResponses,
    },
  }),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const shot = body.screenshot ? decodeScreenshot(body.screenshot) : null;
    const context = { ...body.context, error: body.context.error ? { message: redact(body.context.error.message), stack: body.context.error.stack && redact(body.context.error.stack) } : null };
    const { rows } = await pool.query<{ created_at: Date; inserted: boolean }>(
      `insert into feedback_reports (id, user_id, kind, message, activity, context, screenshot, screenshot_type)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do nothing
       returning created_at, true as inserted`,
      [body.id, user?.id ?? null, body.kind, redact(body.message), JSON.stringify(body.activity.map((a) => ({ at: a.at, event: redact(a.event) }))), JSON.stringify(context), shot?.bytes ?? null, shot?.type ?? null],
    );
    if (rows[0]) return c.json({ id: body.id, receivedAt: rows[0].created_at.toISOString(), duplicate: false }, 201);
    const existing = await pool.query<{ created_at: Date; user_id: string | null }>("select created_at, user_id from feedback_reports where id = $1", [body.id]);
    // Same id from someone else: don't confirm another person's report exists.
    if (existing.rows[0] && existing.rows[0].user_id !== (user?.id ?? null)) throw new ApiError(409, "id_in_use", "Generate a new report id");
    return c.json({ id: body.id, receivedAt: existing.rows[0]!.created_at.toISOString(), duplicate: true }, 200);
  },
);
