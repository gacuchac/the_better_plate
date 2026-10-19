# Build status (current snapshot)

**As of 2026-10-19 · Milestone M1 thin local proof · VERIFIED COMPLETE locally · not deployed**

- **Run it:** `pnpm dev` from a fresh clone. Web http://localhost:3000, API http://localhost:4000.
- **Works end to end locally:** email-code sign-in, 149 USDA foods on device, recipe editing offline, live nutrition with sources and oil disclosures, server revalidation, batch sync with conflicts, account isolation, account deletion.
- **Tests:** 44 unit/API tests and 10 Playwright journeys passing (`pnpm verify`). Details in `docs/test-evidence.md`.
- **Blocked:** cloud dev deploy (Railway S1–S4), real sign-in email (S5), photography (P5).
- **Next:** M2 meals (planned vs eaten), report issue, cooking guidance; first cloud deploy after approval.
- **Ledger:** `docs/requirements-ledger.md`.
