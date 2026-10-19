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
