# Milestone status (append-only)

## Index
| Milestone | Date | Status | Evidence | Commit |
|---|---|---|---|---|
| M1 Thin local proof | 2026-10-19 | VERIFIED COMPLETE (local pass); hosted pass BLOCKED | `artifacts/qa/m1-thin-proof/20261019T140225Z-781e2e5/local/` (regenerate with `pnpm verify`) | branch `claude/project-thread-3kabdi`, PR into `dev` |
| M1.5 Cloud dev, Google sign-in, full SR Legacy | 2026-10-19 | VERIFIED COMPLETE on cloud dev (hosted check green) | Hosted check runs 39276752574, 39286951173 | PRs #4–#6, `dev` d56773f |
| M2 Pilot features: meals, cook mode, report issue, redesign | 2026-10-19 | VERIFIED COMPLETE locally; hosted check on each dev deploy | `artifacts/qa/m2-pilot/<run-id>/local/` (regenerate with `pnpm verify`) | PR #7 (`dev` 2556ce9) and the report-issue PR |

---

## M1 Thin local proof (2026-10-19)

1. **Status:** VERIFIED COMPLETE for the local scope. The hosted (cloud dev) pass of the two-pass gate is BLOCKED on Railway approval, so nothing is deployed.
2. **Delivered:**
   - 149 real USDA FoodData Central SR Legacy foods imported by a Python script through GitHub Actions, versioned and source-attributed.
   - Versioned REST API `/v1` with checked-in OpenAPI 3.1: catalog manifest/bundle/search/lookup/batch, recipes CRUD with `If-Match`, nutrition preview, batch sync protocol 1 (idempotent ops, conflicts, tombstones, cursor pull), account read/delete, health, chef kill switch.
   - Better Auth email one-time-code sign-in with cookie sessions, CSRF/origin checks, rate limits.
   - Shared deterministic nutrition engine: units, portions, servings, known/partial/unknown, measured oil discard with disclosures; server recomputes and stores snapshots per revision.
   - Offline-first PWA: cached app shell, catalog on device, per-account IndexedDB, live estimates with sources, outbox sync with coalescing, honest sync words, explicit conflict choices, Explore foods, sign-out clears device data.
   - One command (`pnpm dev`), `pnpm verify`, SessionStart hook, CI workflow.
   - Storage: migrations `001_auth.sql`, `002_catalog_recipes_sync.sql`.
3. **Verification:** `pnpm verify`: typecheck pass; catalog check pass; 12 engine + 6 sync + 26 API tests pass; 10/10 Playwright journeys (5 journeys × desktop, mobile) with 28 screenshots, inspected. Fresh clone with dropped databases came up with one command. Not run: hosted pass, accessibility audit, rate-limit 429 test, browser XSS test.
4. **Deployment:** local only. No cloud resources exist. Chef flag off.
5. **Defects and limitations:** no real email provider (local mailbox only); USDA online search not built; one requested food unmatched (shrimp); no planned/consumed meals, cooking guidance or report-issue yet; rate limiting is single-instance; no food photography; Railway cookie domain question (ADR-002).
6. **Plan changes:** ADR-001 (TypeScript monorepo, Hono, plain SQL, Vite PWA), ADR-002 (Better Auth email codes). USDA import moved to GitHub Actions because agent sessions could not reach USDA hosts.
7. **Next milestone (M2):** planned and consumed meals with daily/7-day views kept separate, report-issue sheet with offline queue, cooking-method guidance foundations; plus the cloud dev deploy once S1–S4 are approved. Acceptance: API tests for meal events (idempotent consumption, plans ≠ logs, partial days), E2E journeys with screenshots, and the hosted Playwright pass.

---

## M2 Pilot features (2026-10-19)

1. **Status:** VERIFIED COMPLETE for the local pass; each merge into `dev` deploys to Railway dev and runs the hosted check. Production: not deployed.
2. **Delivered:**
   - Planned meals (versioned, conflict choices) and eaten logs (create-only, idempotent, never coalesced, retractable) with server nutrition snapshots frozen at logging time; `GET /v1/meals`; four sync operations; migrations `003_meals.sql`, `004_feedback.sql`.
   - Day and 7-day views that never count plans as eaten, never call a day complete and never average missing meals as zero; % of FDA Daily Values with the FDA source cited.
   - Cook mode: the cook's own steps one at a time, timers from written durations, screen kept awake, safe minimum temperatures from FoodSafety.gov (last reviewed 2024-11-21) mapped from USDA food groups.
   - Report an issue on every screen (sign-in and cook mode included): readable removable steps, optional previewed screenshot with typed text hidden, request ids, sanitized error, offline queue; `POST /v1/feedback`.
   - Redesign from the Claude Design canvas (https://claude.ai/artifact/J7F8Z62ZMQcSxsXiUivrGq): home with today's meals, recipe action bar, sign-in, self-hosted Plus Jakarta Sans (OFL).
3. **Verification:** `pnpm verify`: typecheck pass; nutrition 30, web sync 10, API 46 tests pass; Playwright 20/20 (meals with offline, cook mode, report issue with offline queue, XSS-as-text, plus the M1 journeys) on desktop and mobile; screenshots inspected. CI green on PR #7. Not run: accessibility audit, quota-eviction test.
4. **Deployment:** Railway dev (single service, API serves the PWA), autodeployed from `dev`. Chef flag off. Production untouched.
5. **Defects and limitations:** curated method guides and retention/yield factors not started (no sourced data, nothing generated); no admin triage UI for reports; no food photography (P5); privacy notice/consent versions not built (P3); search ranks some generic words oddly ("milk" shows sheep milk first).
6. **Plan changes:** ADR-004 (meals, % DV, cook mode). Evidence folder renamed to `m2-pilot`.
7. **Next:** release hardening (accessibility audit, backup/restore drill on dev, sync ledger pruning, search aliases), recipe share links, then production readiness once the owner approves P3/S5 and production spend.
