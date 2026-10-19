# Test evidence

Evidence folders are git-ignored (public repo, see preflight N2). Rerun `pnpm verify` to regenerate them; CI uploads the same folder as a 7-day artifact.

## M3 pilot hardening, local pass: 2026-10-19, `dev` 5d384ff plus the privacy-consent change
Command: `pnpm test` then `pnpm e2e`.

| Suite | Result |
|---|---|
| Typecheck (5 workspace packages) | pass |
| Nutrition unit tests incl. everyday-word search and catalog check | 34 / 34 pass |
| Web sync engine unit tests | 10 / 10 pass |
| API integration tests incl. share links, data export, consent, maintenance | 56 / 56 pass |
| Playwright, desktop 1366×900 + Pixel 7, incl. axe-core WCAG 2.2 AA audit, share links, eviction/out-of-space | 26 / 26 pass |

Hosted check (Railway dev) green after PRs #9 (run 39296284845), #10 and #11.

## M2 pilot features, local pass: 2026-10-19, `dev` 2556ce9 plus the report-issue change
Command: `pnpm verify`.

| Suite | Result |
|---|---|
| Typecheck (5 workspace packages) | pass |
| Nutrition, meals, % DV, safe-temperature and search unit tests | 30 / 30 pass |
| Web sync engine unit tests (recipes, plans, logs) | 10 / 10 pass |
| API integration tests (real PostgreSQL 16) incl. meals, issue reports, rate limit | 46 / 46 pass |
| Playwright journeys, desktop 1366×900 + Pixel 7 | 20 / 20 pass |

Screenshots inspected: home with today's meals, recipe action bar, plan and log sheets, meals day view and day nutrients with % DV, 7-day view, cook mode safe temperatures and timer step, report sheet with screenshot preview, offline queued report, sign-in redesign. Issues found and fixed in review: the recipe action bar covered the bottom navigation on phones, the Cook button text vanished on hover, the pan icon was clipped, the summary card rounded fat differently from the panel.

## M1 thin proof, local pass: 2026-10-19, commit 781e2e5 plus docs
Command: `pnpm verify` (= `scripts/test.sh` + `scripts/e2e.sh`).

| Suite | Result |
|---|---|
| Typecheck (5 workspace packages) | pass |
| Catalog snapshot integrity (`import_starter.py --check`) | pass, 149 foods |
| Nutrition engine unit tests | 12 / 12 pass |
| Web sync engine unit tests (fake IndexedDB) | 6 / 6 pass |
| API integration tests (real PostgreSQL 16, fresh schema) | 26 / 26 pass |
| Playwright journeys, desktop 1366×900 + Pixel 7 | 10 / 10 pass |

Evidence: `artifacts/qa/m1-thin-proof/20261019T140225Z-781e2e5/local/` with `screenshots/{desktop,mobile}/01..14-*.png`, `screenshots/manifest.jsonl`, traces under `test-results/`, `report/` (HTML), `results.json`, `junit.xml`.

Screenshots inspected: sign-in, empty kitchen with catalog indicator, editor with unmeasured-oil disclosure, all nutrients, sources drawer, synced editor, kitchen list, offline reload, offline save, reconnect, second account empty, conflict banner, kept both, Explore food detail. Issues found and fixed in review: portion defaulted to an arbitrary first portion (now grams), stale save message beside the conflict banner, zero shown as "0.00", no unsaved-changes cue. Known cosmetic artifact: full-page screenshots draw fixed navigation mid-page; not visible in real use.

Fresh-clone check: a new clone with the role and databases dropped came up with one command (`pnpm dev`), and `/v1/health/ready` reported the catalog loaded.

Not run yet: hosted pass (blocked on Railway approval), accessibility audit, 429 rate-limit test, browser XSS test, quota-eviction test.
