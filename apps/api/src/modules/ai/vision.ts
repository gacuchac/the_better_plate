import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "@betterplate/contracts";
import { config } from "../../config.ts";
import { pool } from "../../db/pool.ts";
import { ApiError, type AuthUser } from "../../lib/http.ts";
import { openKey } from "./byok.ts";
import { fakeRead } from "./fake-vision.ts";
import { isFakeKey } from "./fake.ts";
import { openaiFetch } from "./providers.ts";
import { houseSpendThisMonth } from "./routes.ts";

/**
 * One structured read of photos (a recipe card, a grocery receipt) or of text. The model answers
 * with JSON shaped by `schema`; the caller validates it again. Photos go to the provider once
 * and are not kept anywhere by the app.
 */
export interface ReadArgs {
  /** Names the JSON answer, e.g. "recipe_from_photo". The fake provider picks its fixture by it. */
  name: string;
  system: string;
  text: string;
  /** WebP bytes, already re-encoded with metadata dropped. */
  images: Buffer[];
  schema: Record<string, unknown>;
}

export interface ReadKey {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** The included companion (owner's key): counted against its daily cap and monthly budget. */
  house: boolean;
}

export interface ReadResult {
  output: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

async function importsToday(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string | null }>("select sum(imports) as n from ai_house_usage where user_id = $1 and day = current_date", [userId]);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Which key reads the photos: the person's own (their active provider) when connected, otherwise
 * the included companion within its daily read cap and monthly budget.
 */
export async function readKeyFor(user: AuthUser): Promise<ReadKey> {
  const { rows } = await pool.query<{ provider: AiProvider; model: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; active: boolean }>(
    `select c.provider, c.model, c.ciphertext, c.iv, c.auth_tag, coalesce(s.active_provider = c.provider, false) as active
       from ai_credentials c left join ai_settings s on s.user_id = c.user_id
      where c.user_id = $1 order by active desc, c.provider`,
    [user.id],
  );
  const own = rows[0];
  if (own && config.byokKey) {
    return { provider: own.provider, apiKey: openKey({ ciphertext: own.ciphertext, iv: own.iv, authTag: own.auth_tag }, user.id, own.provider), model: own.model, house: false };
  }
  const h = config.house;
  const invited = h.allowedEmails === "*" || h.allowedEmails.has(user.email.toLowerCase());
  if (!h.apiKey || !invited) throw new ApiError(404, "not_connected", "Connect an AI key in AI settings to read photos");
  if ((await houseSpendThisMonth()) >= h.monthlyBudgetUsd) {
    throw new ApiError(429, "ai_house_budget", "The included companion is used up for this month; connect your own AI key in AI settings to keep going");
  }
  if ((await importsToday(user.id)) >= h.dailyImports) {
    throw new ApiError(429, "ai_daily_import_limit", `You used today's ${h.dailyImports} included photo reads; it resets tomorrow, or connect your own AI key`);
  }
  return { provider: "openai", apiKey: h.apiKey, model: h.importModel, house: true };
}

/** Counts one read (a recipe or a receipt) and its tokens. Own keys are counted as requests. */
export async function countRead(userId: string, key: ReadKey, results: ReadResult[]): Promise<void> {
  const input = results.reduce((s, r) => s + r.usage.inputTokens, 0);
  const output = results.reduce((s, r) => s + r.usage.outputTokens, 0);
  if (key.house) {
    await pool.query(
      `insert into ai_house_usage (user_id, day, model, imports, input_tokens, output_tokens) values ($1, current_date, $2, 1, $3, $4)
       on conflict (user_id, day, model) do update set imports = ai_house_usage.imports + 1,
         input_tokens = ai_house_usage.input_tokens + $3, output_tokens = ai_house_usage.output_tokens + $4`,
      [userId, key.model, input, output],
    );
  } else {
    await pool.query(
      `insert into ai_usage (user_id, day, requests, input_tokens, output_tokens) values ($1, current_date, 1, $2, $3)
       on conflict (user_id, day) do update set requests = ai_usage.requests + 1,
         input_tokens = ai_usage.input_tokens + $2, output_tokens = ai_usage.output_tokens + $3`,
      [userId, input, output],
    );
  }
}

const notImages = (message: string) => /image|vision|multimodal|content type/i.test(message);

export async function readStructured(key: ReadKey, args: ReadArgs): Promise<ReadResult> {
  if (config.isLocal && isFakeKey(key.apiKey)) return { output: fakeRead(args), model: "fake-vision", usage: { inputTokens: 1200, outputTokens: 400 } };
  return key.provider === "anthropic" ? readAnthropic(key, args) : readOpenAi(key, args);
}

async function readOpenAi(key: ReadKey, args: ReadArgs): Promise<ReadResult> {
  const content = [
    { type: "text", text: args.text },
    ...args.images.map((b) => ({ type: "image_url", image_url: { url: `data:image/webp;base64,${b.toString("base64")}`, detail: "high" } })),
  ];
  const body = {
    model: key.model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: { name: args.name, schema: args.schema, strict: false } },
  };
  let data: Record<string, unknown>;
  try {
    data = await openaiFetch(key.apiKey, "/chat/completions", body);
  } catch (err) {
    if (err instanceof ApiError && err.code === "ai_provider_rejected" && args.images.length && notImages(err.message)) {
      throw new ApiError(422, "ai_model_no_images", "This AI model can't read photos; pick another model in AI settings");
    }
    throw err;
  }
  const choice = (data.choices as { message: { content: string | null; refusal?: string | null } }[] | undefined)?.[0];
  if (!choice || choice.message.refusal) throw new ApiError(422, "ai_unreadable", "The photo couldn't be read; try a clearer photo");
  const usage = (data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
  return { output: parseJson(choice.message.content), model: String(data.model ?? key.model), usage: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } };
}

async function readAnthropic(key: ReadKey, args: ReadArgs): Promise<ReadResult> {
  const client = new Anthropic({ apiKey: key.apiKey, maxRetries: 2, timeout: 180_000 });
  try {
    const res = await client.messages.create({
      model: key.model,
      max_tokens: 8000,
      system: args.system,
      tools: [{ name: args.name, description: "Return what you read, in this shape.", input_schema: args.schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: args.name },
      messages: [
        {
          role: "user",
          content: [
            ...args.images.map((b) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/webp" as const, data: b.toString("base64") } })),
            { type: "text" as const, text: args.text },
          ],
        },
      ],
    });
    const use = res.content.find((b) => b.type === "tool_use");
    if (!use || use.type !== "tool_use") throw new ApiError(422, "ai_unreadable", "The photo couldn't be read; try a clearer photo");
    return { output: use.input, model: res.model, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ApiError(400, "ai_key_invalid", "Anthropic did not accept this API key");
    if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, "ai_provider_rate_limited", "Anthropic is rate limiting your key; try again shortly");
    if (err instanceof Anthropic.BadRequestError) throw new ApiError(422, "ai_unreadable", "The photo couldn't be read; try a clearer photo");
    if (err instanceof Anthropic.APIConnectionError) throw new ApiError(503, "ai_provider_unreachable", "Couldn't reach Anthropic");
    throw new ApiError(503, "ai_provider_error", "Anthropic had a problem answering; try again");
  }
}

function parseJson(text: string | null): unknown {
  const raw = (text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(422, "ai_unreadable", "The photo couldn't be read; try a clearer photo");
  }
}
