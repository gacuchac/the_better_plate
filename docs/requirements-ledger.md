# Requirements ledger

Single source of feature-to-test traceability (AGENTS.md). States: `verified` (passing tests, plus screenshots when it has UI), `implemented-unverified`, `staging-only`, `blocked`, `not-started`. **Last updated:** 2026-10-19, milestone M1 (thin local proof), local only.

Test references: `API` = `apps/api/test/api.test.ts`, `ENG` = `packages/nutrition/src/calculate.test.ts`, `SYNC` = `apps/web/src/sync.test.ts`, `E2E` = `e2e/journeys.spec.ts` (desktop + mobile, screenshots in `artifacts/qa/m1-thin-proof/<run>/local/`).

| PRODUCT.md | Requirement | Implementation | Evidence | State |
|---|---|---|---|---|
| §2.1 | Email sign-in with verification (one-time code) | `apps/api/src/auth.ts`, `apps/web/src/ui/SignIn.tsx` | API "signs in…", "rejects a wrong code"; E2E all journeys | verified (local; real email provider blocked on S5) |
| §2.1 | Google sign-in (OIDC) | `apps/api/src/auth.ts`, redirect guard in `apps/api/src/app.ts`, `apps/web/src/ui/SignIn.tsx` | API "Google sign-in" (methods, redirect to Google with PKCE, foreign callback rejected); E2E "Continue with Google sends you to Google…" (Google stubbed) | verified (dev: owner signed in with Google, 2026-10-19) |
| §2.1 | Session revocation / sign-out | Better Auth sign-out; web clears personal DB | E2E "accounts are isolated" | verified |
| §2.1 | Per-record ownership, no cross-user access | `modules/recipes.ts`, `modules/sync.ts` | API "account isolation"; E2E isolation | verified |
| §2.1 | CSRF / CORS / cookies | `lib/http.ts`, `app.ts`, ADR-002 | API "request safety" | verified |
| §2.1 | Rate limiting | `lib/http.ts` (memory), Better Auth limits | API "rate limiting" (429 + Retry-After) | verified (single instance; shared store needed before scaling out) |
| §2.1 | Account deletion | `DELETE /v1/me` | API "account deletion" | verified (UI button untested) |
| §2.1 | Data export: everything stored about the account (account, linked sign-ins, sessions, recipes with every revision, planned and eaten meals, share links, issue reports with screenshots) as JSON; unsynced drafts export offline | `GET /v1/me/export`, You screen | API "data export"; E2E accounts journey downloads and parses the file | verified (local) |
| §2.1 | Clear local data on logout/account change | `store.tsx` per-account IndexedDB | E2E isolation checks IndexedDB is gone | verified |
| §2.1 | Privacy notice versions, consent events, admin MFA, passkeys | — | — | not-started |
| §2.2 | Official USDA records, IDs, per-100 g, portions, source URL/date | `scripts/usda/import_starter.py`, `data/catalog/` | API "catalog" tests; importer `--check` | verified (all 7,793 SR Legacy foods) |
| §2.2 | Versioned catalog on device: all of SR Legacy (owner decision, ADR-003) | catalog version + `GET /v1/catalog/manifest`, gzip bundle | API manifest/bundle/ETag/gzip | verified |
| §2.2 | Search: words in any order, partial words, plurals; same ranking offline and online | `packages/nutrition/src/search.ts`, `GET /v1/foods`, `FoodPicker.tsx` | Unit "food search"; API search/paging; E2E ingredient search | verified |
| §2.2 | Missing nutrients flagged, never zero | importer omits unreported; engine statuses | ENG "never treats a missing nutrient as zero" | verified |
| §2.2 | Search, batch lookup, offline cache | `/v1/foods`, `/v1/foods/batch`, IndexedDB catalog | API search/batch; E2E offline reload, Explore | verified |
| §2.2 | Online search of full USDA; delta updates; allergen/kosher flags; Foundation foods | — | — | not-started (online search blocked here: USDA hosts denied in cloud sessions) |
| §2.3 | Units, portions, recipe sums, per serving, fractional servings | `packages/nutrition` | ENG; E2E browser value equals server value | verified |
| §2.3 | Known/partial/unknown with provenance | engine + Sources drawer | ENG; E2E sources drawer | verified |
| §2.3 | Oil added vs discarded (measured) | engine `cooking_oil` role | ENG; E2E disclosure appears/disappears | verified |
| §2.3 | Historical snapshots (catalog + engine version per revision) | `recipe_revisions` | API idempotency test reads revisions | verified |
| §2.3 | Daily and 7-day views, plans strictly separate from logs, partial days never complete; FDA %DV with citation | `packages/nutrition/src/meals.ts`, `daily-values.ts`, `apps/web/src/meals.ts`, `ui/Meals.tsx` | Unit "meal totals", "percent Daily Value"; E2E "plan a meal, mark it eaten…" (day totals = server snapshot, 7-day view) | verified |
| §2.3 | Yield and retention factors, cooked/raw conversion, DRI categories | — | — | not-started (no sourced retention data imported yet) |
| §2.4 | Cook mode: the cook's own steps one at a time, timers from written durations, screen kept awake, safe minimum temperatures cited from FoodSafety.gov | `packages/nutrition/src/safety.ts`, `ui/Cook.tsx` | Unit "safe temperature rules", "steps from the person's own method"; E2E "cook mode…" | verified |
| §2.4 | Curated ingredient × method templates (18 methods), method education, unsafe-method exclusion | — | — | not-started (needs sourced, tested method content; nothing generated) |
| §2.5 | Static catalog bundle cached on device, IndexedDB recipes, durable outbox | `localdb.ts`, `sync.ts` | SYNC; E2E offline reload | verified |
| §2.5 | Local-first save, refresh persistence, live local calculation | `RecipeEditor.tsx` | E2E offline journey | verified |
| §2.5 | Storage persistence request; export unsynced drafts | `requestPersistentStorage`, You screen | none automated | implemented-unverified |
| §2.5 | Quota/eviction recovery UI | — | — | not-started |
| §2.6 | Versioned batch sync, bounded ops, UUID idempotency, per-op status, cursor pull, tombstones | `modules/sync.ts`, `contracts` | API "batch sync protocol 1" (6 tests) | verified |
| §2.6 | Coalesce edits; sync on resume/reconnect/debounce/Sync now | `sync.ts`, `store.tsx` | SYNC coalescing; E2E reconnect | verified |
| §2.6 | Conflict UI: keep local / cloud / both, no silent overwrite | `RecipeEditor.tsx` ConflictBanner | SYNC; E2E two-device conflict | verified (keep both via UI; keep mine/cloud unit-tested) |
| §2.6 | Planned meals (versioned, conflict UI) and immutable, idempotent consumption events with server nutrition snapshots; never coalesced; retractable with tombstones | `003_meals.sql`, `modules/meals.ts`, `modules/sync.ts`, `sync.ts`, `GET /v1/meals` | API "planned and eaten meals" (9 tests); SYNC "meals" (4 tests); E2E meals journey incl. offline | verified |
| §2.7 | Recommendations, evidence claim registry, nutrient education | — | — | not-started |
| §2.8 | BYOK AI companion, image generation | — | — | not-started (later) |
| §2.9 | Revocable read-only share links: owner reviews the exact fields, method opt-in, optional expiry, random UUID, snapshot frozen at the shared version, revoke erases the snapshot, recipe delete ends its links, no owner identity; link preview page with escaped title; native share with copy/email/text fallbacks; online only | `005_shares.sql`, `modules/shares.ts`, `ui/Share.tsx` | API "recipe share links" (7 tests); E2E "share a recipe…" (offline refusal, guest view, revoke) | verified (local) |
| §2.9 | Public metadata image, share revisions history | — | — | not-started (no licensed food photography yet) |
| §2.10 | Chef module OFF with server enforcement | `/v1/chef/*` kill switch, config refuses ON in production | API "keeps unreleased chef features off" | verified (module itself not-started) |
| §2.11 | Report issue on every screen (incl. sign-in and cook mode): bug / feedback / suggestion, readable removable recent steps, optional previewed screenshot with typed text hidden, request ids, sanitized error, offline queue with idempotent retry | `modules/feedback.ts`, `004_feedback.sql`, `ui/ReportIssue.tsx`, `activity.ts`, `feedbackQueue.ts` | API "issue reports" (4 tests); E2E "report an issue…" (sent + offline queue) | verified |
| §2.11 | Admin triage of reports (statuses exist in schema), admin console | — | — | not-started (needs admin role and MFA) |
| §2.11 | Correlation IDs, structured errors, structured logs | `X-Request-Id`, `errorBody`, JSON logs | API "structured errors with a request id" | verified |
| §3 | OpenAPI 3.1 checked in, `/v1`, runtime validation | `apps/api/openapi.json` | API "checked-in OpenAPI document matches" | verified |
| §3 | Typed client library generated from OpenAPI | shared zod contracts used by web | — | implemented-unverified (no generated client yet) |
| §3 | Health live/ready | `/v1/health/*` | API readiness test | verified |
| §4 | UUIDs, versions, indexes, FKs, safe migrations | `001_auth.sql`, `002_catalog_recipes_sync.sql`, migration hash check | API suite runs on a fresh schema | verified |
| §5 | XSS: names stored as text, rendered escaped | React escaping; share preview page HTML-escapes | API "stores markup as plain text", "escaped link preview page"; E2E "recipe names with markup are shown as text" | verified |
| §5 | Secret scanning in CI, keys never in bundles | `.github/workflows/ci.yml` (gitleaks), `PUBLIC_` prefix only | CI "Secret scan" job green on every PR | verified |
| §6 | Four destinations, bottom nav / desktop rail, sync status words; redesign from the Claude Design canvas (Plus Jakarta Sans, self-hosted, OFL) | `ui/App.tsx`, `styles.css`, `SyncChip` | E2E screenshots desktop + mobile, reviewed 2026-10-19 | verified |
| §6 | Brand colors, 44px targets, Estimated cue, not-reported ≠ 0 | `styles.css`, Nutrition panel | Screenshots reviewed (M1) | verified (visual review) |
| §6 | WCAG 2.2 AA automated audit (axe-core, wcag2a/aa, 2.1, 2.2 tags) on 15 screens and sheets, desktop and mobile; sheets move focus in, trap Tab, return focus on Escape | `e2e/a11y.spec.ts`, `ui/common.tsx` Sheet | E2E "core screens have no automatically detectable WCAG 2.2 AA violations" | verified (automated rules only; manual screen-reader pass not done) |
| §6 | Spanish-ready strings | — | — | not-started |
| §6 | Real food photography | — | — | blocked (licenses, preflight P5) |
| §7 | Deployment, backups, restore drill, monitoring | — | — | blocked (Railway approval, preflight S1–S4) |
