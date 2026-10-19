# Requirements ledger

Single source of feature-to-test traceability (AGENTS.md). States: `verified` (passing tests, plus screenshots when it has UI), `implemented-unverified`, `staging-only`, `blocked`, `not-started`. **Last updated:** 2026-10-19, milestone M1 (thin local proof), local only.

Test references: `API` = `apps/api/test/api.test.ts`, `ENG` = `packages/nutrition/src/calculate.test.ts`, `SYNC` = `apps/web/src/sync.test.ts`, `E2E` = `e2e/journeys.spec.ts` (desktop + mobile, screenshots in `artifacts/qa/m1-thin-proof/<run>/local/`).

| PRODUCT.md | Requirement | Implementation | Evidence | State |
|---|---|---|---|---|
| §2.1 | Email sign-in with verification (one-time code) | `apps/api/src/auth.ts`, `apps/web/src/ui/SignIn.tsx` | API "signs in…", "rejects a wrong code"; E2E all journeys | verified (local; real email provider blocked on S5) |
| §2.1 | Google sign-in (OIDC) | `apps/api/src/auth.ts`, redirect guard in `apps/api/src/app.ts`, `apps/web/src/ui/SignIn.tsx` | API "Google sign-in" (methods, redirect to Google with PKCE, foreign callback rejected); E2E "Continue with Google sends you to Google…" (Google stubbed) | implemented-unverified (real Google round trip needs owner's OAuth client) |
| §2.1 | Session revocation / sign-out | Better Auth sign-out; web clears personal DB | E2E "accounts are isolated" | verified |
| §2.1 | Per-record ownership, no cross-user access | `modules/recipes.ts`, `modules/sync.ts` | API "account isolation"; E2E isolation | verified |
| §2.1 | CSRF / CORS / cookies | `lib/http.ts`, `app.ts`, ADR-002 | API "request safety" | verified |
| §2.1 | Rate limiting | `lib/http.ts` (memory), Better Auth limits | Headers present; no dedicated 429 test yet | implemented-unverified |
| §2.1 | Account deletion | `DELETE /v1/me` | API "account deletion" | verified (UI button untested) |
| §2.1 | Data export | Unsynced-draft export only (You screen) | none | implemented-unverified; full export not-started |
| §2.1 | Clear local data on logout/account change | `store.tsx` per-account IndexedDB | E2E isolation checks IndexedDB is gone | verified |
| §2.1 | Privacy notice versions, consent events, admin MFA, passkeys | — | — | not-started |
| §2.2 | Official USDA records, IDs, per-100 g, portions, source URL/date | `scripts/usda/import_starter.py`, `data/catalog/` | API "catalog" tests; importer `--check` | verified (149 SR Legacy foods) |
| §2.2 | Versioned catalog on device: all of SR Legacy (owner decision, ADR-003) | catalog version + `GET /v1/catalog/manifest`, gzip bundle | API manifest/bundle/ETag/gzip | verified |
| §2.2 | Search: words in any order, partial words, plurals; same ranking offline and online | `packages/nutrition/src/search.ts`, `GET /v1/foods`, `FoodPicker.tsx` | Unit "food search"; API search/paging; E2E ingredient search | verified |
| §2.2 | Missing nutrients flagged, never zero | importer omits unreported; engine statuses | ENG "never treats a missing nutrient as zero" | verified |
| §2.2 | Search, batch lookup, offline cache | `/v1/foods`, `/v1/foods/batch`, IndexedDB catalog | API search/batch; E2E offline reload, Explore | verified |
| §2.2 | Online search of full USDA; delta updates; allergen/kosher flags; Foundation foods | — | — | not-started (online search blocked here: USDA hosts denied in cloud sessions) |
| §2.3 | Units, portions, recipe sums, per serving, fractional servings | `packages/nutrition` | ENG; E2E browser value equals server value | verified |
| §2.3 | Known/partial/unknown with provenance | engine + Sources drawer | ENG; E2E sources drawer | verified |
| §2.3 | Oil added vs discarded (measured) | engine `cooking_oil` role | ENG; E2E disclosure appears/disappears | verified |
| §2.3 | Historical snapshots (catalog + engine version per revision) | `recipe_revisions` | API idempotency test reads revisions | verified |
| §2.3 | Yield and retention factors, cooked/raw conversion, DV/DRI references, daily/7-day views | — | — | not-started |
| §2.4 | Cooking knowledge base, methods, safety temperatures, cook mode | — | — | not-started |
| §2.5 | Static catalog bundle cached on device, IndexedDB recipes, durable outbox | `localdb.ts`, `sync.ts` | SYNC; E2E offline reload | verified |
| §2.5 | Local-first save, refresh persistence, live local calculation | `RecipeEditor.tsx` | E2E offline journey | verified |
| §2.5 | Storage persistence request; export unsynced drafts | `requestPersistentStorage`, You screen | none automated | implemented-unverified |
| §2.5 | Quota/eviction recovery UI | — | — | not-started |
| §2.6 | Versioned batch sync, bounded ops, UUID idempotency, per-op status, cursor pull, tombstones | `modules/sync.ts`, `contracts` | API "batch sync protocol 1" (6 tests) | verified |
| §2.6 | Coalesce edits; sync on resume/reconnect/debounce/Sync now | `sync.ts`, `store.tsx` | SYNC coalescing; E2E reconnect | verified |
| §2.6 | Conflict UI: keep local / cloud / both, no silent overwrite | `RecipeEditor.tsx` ConflictBanner | SYNC; E2E two-device conflict | verified (keep both via UI; keep mine/cloud unit-tested) |
| §2.6 | Planned meals and consumption events | — | — | not-started (next slice) |
| §2.7 | Recommendations, evidence claim registry, nutrient education | — | — | not-started |
| §2.8 | BYOK AI companion, image generation | — | — | not-started (later) |
| §2.9 | Recipe share links | — | — | not-started |
| §2.10 | Chef module OFF with server enforcement | `/v1/chef/*` kill switch, config refuses ON in production | API "keeps unreleased chef features off" | verified (module itself not-started) |
| §2.11 | Report issue on every screen, activity trail, screenshots, offline queue | — | — | not-started (next slice) |
| §2.11 | Correlation IDs, structured errors, structured logs | `X-Request-Id`, `errorBody`, JSON logs | API "structured errors with a request id" | verified |
| §3 | OpenAPI 3.1 checked in, `/v1`, runtime validation | `apps/api/openapi.json` | API "checked-in OpenAPI document matches" | verified |
| §3 | Typed client library generated from OpenAPI | shared zod contracts used by web | — | implemented-unverified (no generated client yet) |
| §3 | Health live/ready | `/v1/health/*` | API readiness test | verified |
| §4 | UUIDs, versions, indexes, FKs, safe migrations | `001_auth.sql`, `002_catalog_recipes_sync.sql`, migration hash check | API suite runs on a fresh schema | verified |
| §5 | XSS: names stored as text, rendered escaped | React escaping | API "stores markup as plain text" | implemented-unverified (no browser XSS test yet) |
| §5 | Secret scanning in CI, keys never in bundles | `.github/workflows/ci.yml` (gitleaks), `PUBLIC_` prefix only | CI pending first run | implemented-unverified |
| §6 | Four destinations, bottom nav / desktop rail, sync status words | `ui/App.tsx`, `SyncChip` | E2E screenshots desktop + mobile | verified |
| §6 | Brand colors, 44px targets, Estimated cue, not-reported ≠ 0 | `styles.css`, Nutrition panel | Screenshots reviewed (M1) | verified (visual review) |
| §6 | WCAG 2.2 AA audit, Spanish-ready strings | — | — | not-started |
| §6 | Real food photography | — | — | blocked (licenses, preflight P5) |
| §7 | Deployment, backups, restore drill, monitoring | — | — | blocked (Railway approval, preflight S1–S4) |
