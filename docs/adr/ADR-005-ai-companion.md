# ADR-005: AI companion (bring your own key)

**Status:** accepted · **Date:** 2026-10-19 · **Decided by:** owner (control level, "Act, with undo"; key model) and agent (architecture)

## Context

PRODUCT.md §2.8 asks for an optional AI companion on the person's own OpenAI or Anthropic key, with keys never exposed to the browser, typed bounded tools, reviewable consequential actions and a complete non-AI fallback. The owner asked that the agent can operate the whole account while the person watches it build recipes, log meals and navigate. Asked how much it may do unasked, the owner chose **act, with undo**: it saves recipes, plans and logs meals, sets targets and navigates on its own; deleting (and later sharing, exporting and account changes) waits for the person's tap.

Signing in with a ChatGPT or Claude subscription instead of a key was considered: Anthropic's terms do not allow consumer subscriptions in third-party apps, and OpenAI's "Sign in with ChatGPT" is partner-only for now. A Claude/ChatGPT connector (MCP with OAuth) is the planned follow-up.

## Decisions

1. **Model on the server, tools on the device.** `POST /v1/ai/turn` decrypts the key and calls the provider; returned tool calls are validated against the shared zod schemas (`packages/contracts/src/ai.ts`) and sent to the app, which validates again and runs them against the same IndexedDB stores and sync engine the screens use. Every step is visible, works with local-first saving, and gets an Undo when reversible.
2. **Client holds the transcript.** The provider-native conversation is kept in memory in the tab and echoed back each step (≤120 messages, 1.5 MB). The server stores no messages, only per-day request and token counts. Role smuggling is rejected (`invalid_conversation`).
3. **Keys.** AES-256-GCM with associated data `userId:provider`, key-encryption key `BYOK_ENCRYPTION_KEY` (derived from `SESSION_SECRET` only for local runs). Keys are validated with the provider on connect, never returned (only the last four characters), never logged, and excluded from data exports.
4. **Bounded tools.** 12 typed tools, no generic HTTP or database access. Nutrition numbers in replies come only from tool results computed by the deterministic engine; the system prompt forbids target recommendations, medical advice and invented safety rules, and treats tool output as data.
5. **Limits.** Per-person daily request limit (default 200, 1–2000), 60 turns/minute and 20 key changes/hour per user, at most 24 steps per message, a Stop button.
6. **Providers.** Anthropic through the official SDK (`@anthropic-ai/sdk`), OpenAI through Chat Completions over HTTPS. A scripted fake provider (keys starting `fake-local-`) runs only when `APP_ENV` is local or test, for automated journeys.

## Alternatives considered

- Tools executed on the server: rejected; changes would bypass the local-first store and arrive as sync conflicts instead of live steps.
- Asking before every write: offered to the owner, not chosen.
- Storing chat history: not needed for the product; kept out for data minimization.

## Consequences

- Off unless `FEATURE_AI_COMPANION_ENABLED=true`; every `/v1/ai/*` route returns 404 when off.
- Not verified against real providers in automated tests (no shared keys); a real-key smoke test needs an owner-provided key in CI (`E2E_AI_API_KEY`, optional).
- Image search and generation, and the external connector, are separate follow-ups.

## Addendum (2026-10-19): included companion on the owner's key

Owner decision: "we can have our own key set up for luna and limit usage at first to evaluate and control cost."

- `OPENAI_HOUSE_API_KEY` (owner-provided, Railway only) powers turns with `provider: "house"`, on `AI_HOUSE_MODEL` (default `gpt-6-luna`), through the same OpenAI adapter, tool validation and system prompt as BYOK.
- Who: `AI_HOUSE_ALLOWED_EMAILS` (invite list; `*` = everyone). A person's own key, when connected and active, always takes priority.
- Limits: `AI_HOUSE_DAILY_REQUESTS` per person per day, and `AI_HOUSE_MONTHLY_BUDGET_USD` across all accounts, estimated from reported token counts × configured prices. Checked before each turn, so concurrent turns can overshoot slightly; the OpenAI project's own budget limit is the hard stop.
- Counters live in `ai_house_usage`; they survive account deletion without the account link so deleting and re-creating accounts can't reset the monthly total.
- Photo generation stays on people's own keys (about $0.04 per image).
- Privacy: messages and the recipe and meal details the companion reads go to OpenAI under The Better Plate's account; AI settings says so.

### Addendum (2026-10-19): fewer tools on the included companion

Owner decision: "just having a couple of tools for luna should be enough". The included companion is offered only `search_foods`, `list_recipes`, `save_recipe`, `plan_meal`, `log_meal` and `get_day`, with a shorter system prompt. Every turn sends fewer tool definitions, which costs less and gives the small model fewer ways to go wrong. The server refuses any other tool call on that provider. Since there is no `navigate`, the app opens the saved recipe or the planned or logged day itself. `list_recipes` stays because logging a meal needs an existing recipe's id. Own-key companions keep the full set. Not available on the included companion: editing an existing recipe (no `get_recipe`), photos, targets and deletes. Its answer points people to the app for those.
