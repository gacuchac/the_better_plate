import Anthropic from "@anthropic-ai/sdk";
import { z } from "@hono/zod-openapi";
import { AI_TOOL_NAMES, AI_TOOLS, type AiProvider } from "@betterplate/contracts";
import { config } from "../../config.ts";
import { ApiError } from "../../lib/http.ts";
import { redact } from "../feedback.ts";
import { fakeTurn, isFakeKey } from "./fake.ts";

export type Native = Record<string, unknown>;

export type TurnInput = { type: "message"; text: string } | { type: "tool_results"; results: { id: string; output: string; isError: boolean }[] };

export interface ProviderTurn {
  conversation: Native[];
  text: string;
  toolCalls: { id: string; name: string; input: unknown }[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface TurnArgs {
  apiKey: string;
  model: string;
  system: string;
  conversation: Native[];
  input: TurnInput;
}

interface Adapter {
  /** Validates the key and lists chat models it can use, preferred first. */
  listModels(apiKey: string): Promise<string[]>;
  turn(args: TurnArgs): Promise<ProviderTurn>;
}

const toolSchemas = AI_TOOL_NAMES.map((name) => ({
  name,
  description: AI_TOOLS[name].description,
  parameters: z.toJSONSchema(AI_TOOLS[name].input, { io: "input" }) as Record<string, unknown>,
}));

const MAX_TOKENS = 16_000;

// ---------------------------------------------------------------- Anthropic (official SDK)

/** Server-side refusal fallback is offered on these models (Claude API). */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;
const ANTHROPIC_PREFERRED = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

function anthropicError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new ApiError(400, "ai_key_invalid", "Anthropic did not accept this API key");
  }
  if (err instanceof Anthropic.NotFoundError) throw new ApiError(400, "ai_model_unavailable", "This model isn't available to your Anthropic key");
  if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, "ai_provider_rate_limited", "Anthropic is rate limiting your key; try again shortly");
  if (err instanceof Anthropic.BadRequestError) throw new ApiError(422, "ai_provider_rejected", redact(err.message).slice(0, 300));
  if (err instanceof Anthropic.APIError) throw new ApiError(503, "ai_provider_error", "Anthropic had a problem answering; try again");
  if (err instanceof Anthropic.APIConnectionError) throw new ApiError(503, "ai_provider_unreachable", "Couldn't reach Anthropic");
  throw err;
}

const anthropic: Adapter = {
  async listModels(apiKey) {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
    try {
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      const chat = ids.filter((id) => id.startsWith("claude-"));
      return [...ANTHROPIC_PREFERRED.filter((id) => chat.includes(id)), ...chat.filter((id) => !ANTHROPIC_PREFERRED.includes(id))];
    } catch (err) {
      anthropicError(err);
    }
  },

  async turn({ apiKey, model, system, conversation, input }) {
    const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
    const next: Anthropic.Beta.BetaMessageParam =
      input.type === "message"
        ? { role: "user", content: input.text }
        : { role: "user", content: input.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.output, is_error: r.isError })) };
    const messages = [...(conversation as unknown as Anthropic.Beta.BetaMessageParam[]), next];
    try {
      const res = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        tools: toolSchemas.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
        output_config: { effort: "medium" },
        ...(FALLBACK_MODELS.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      const toolCalls = res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []));
      const refused = res.stop_reason === "refusal";
      return {
        // The assistant turn goes back unchanged (thinking blocks included) on the next request.
        conversation: [...messages, { role: "assistant", content: res.content }] as unknown as Native[],
        text: refused ? "I can't help with that request." : res.stop_reason === "max_tokens" && !text ? "That answer got too long; try asking for less at once." : text,
        toolCalls: refused ? [] : toolCalls,
        model: res.model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    } catch (err) {
      anthropicError(err);
    }
  },
};

// ---------------------------------------------------------------- OpenAI (Chat Completions over HTTPS)

const OPENAI_URL = "https://api.openai.com/v1";
const NOT_CHAT = /audio|realtime|transcribe|tts|image|search|embedding|moderation|dall-e|whisper|codex|instruct/;

export async function openaiFetch(apiKey: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${OPENAI_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new ApiError(503, "ai_provider_unreachable", "Couldn't reach OpenAI");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return data;
  const message = redact(String((data.error as { message?: string } | undefined)?.message ?? res.statusText)).slice(0, 300);
  if (res.status === 401 || res.status === 403) throw new ApiError(400, "ai_key_invalid", "OpenAI did not accept this API key");
  if (res.status === 404) throw new ApiError(400, "ai_model_unavailable", "This model isn't available to your OpenAI key");
  if (res.status === 429) throw new ApiError(429, "ai_provider_rate_limited", "OpenAI is rate limiting your key or it has no credit left");
  if (res.status === 400) throw new ApiError(422, "ai_provider_rejected", message);
  throw new ApiError(503, "ai_provider_error", "OpenAI had a problem answering; try again");
}

const openai: Adapter = {
  async listModels(apiKey) {
    const data = await openaiFetch(apiKey, "/models");
    const ids = ((data.data as { id: string }[] | undefined) ?? []).map((m) => m.id).filter((id) => /^(gpt-\d|o\d)/.test(id) && !NOT_CHAT.test(id));
    // Newest general model first: plain gpt-N(.M) before dated or size variants.
    return ids.sort((a, b) => {
      const rank = (id: string) => (/^gpt-\d+(\.\d+)?$/.test(id) ? 0 : /^gpt-/.test(id) ? 1 : 2);
      return rank(a) - rank(b) || b.localeCompare(a, "en", { numeric: true });
    });
  },

  async turn({ apiKey, model, system, conversation, input }) {
    const next: Native[] =
      input.type === "message" ? [{ role: "user", content: input.text }] : input.results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.isError ? `Error: ${r.output}` : r.output }));
    const messages = [...conversation, ...next];
    const data = await openaiFetch(apiKey, "/chat/completions", {
      model,
      messages: [{ role: "system", content: system }, ...messages],
      tools: toolSchemas.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    });
    const choice = (data.choices as { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; refusal?: string | null } }[])[0];
    if (!choice) throw new ApiError(503, "ai_provider_error", "OpenAI returned no answer");
    const msg = choice.message;
    const toolCalls = (msg.tool_calls ?? []).map((c) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(c.function.arguments || "{}");
      } catch {
        parsed = undefined;
      }
      return { id: c.id, name: c.function.name, input: parsed };
    });
    const usage = (data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
    const assistant: Native = { role: "assistant", content: msg.content ?? "" };
    if (msg.tool_calls?.length) assistant.tool_calls = msg.tool_calls.map((c) => ({ id: c.id, type: "function", function: c.function }));
    return {
      conversation: [...messages, assistant],
      text: (msg.refusal ? "I can't help with that request." : msg.content ?? "").trim(),
      toolCalls,
      model: String(data.model ?? model),
      usage: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 },
    };
  },
};

// ---------------------------------------------------------------- selection

const ADAPTERS: Record<AiProvider, Adapter> = { anthropic, openai };

/** Local and test runs accept a scripted fake key so journeys run without a provider account. */
export function adapterFor(provider: AiProvider, apiKey: string): Adapter {
  if (config.isLocal && isFakeKey(apiKey)) return { listModels: async () => ["fake-companion"], turn: fakeTurn };
  return ADAPTERS[provider];
}

/** Rejects transcripts a client could have tampered with to smuggle in system or other roles. */
export function checkConversation(provider: AiProvider, conversation: Native[]) {
  const allowed = provider === "anthropic" ? ["user", "assistant"] : ["user", "assistant", "tool"];
  for (const m of conversation) {
    if (!allowed.includes(String(m.role))) throw new ApiError(400, "invalid_conversation", "The conversation has an unexpected message");
  }
  if (conversation.length && conversation[0]!.role !== "user") throw new ApiError(400, "invalid_conversation", "The conversation must start with your message");
}
