# Build status (current snapshot)

**As of 2026-10-19 · Milestone M2 Your Kitchen pilot features · VERIFIED COMPLETE locally; cloud dev deploys from `dev` · production not deployed**

- **Run it:** `pnpm dev` from a fresh clone. Web http://localhost:3000, API http://localhost:4000. Cloud dev: https://thebetterplate-dev.up.railway.app (autodeploys each merge into `dev`, then the hosted Playwright check runs).
- **Works end to end:** email-code and Google sign-in; all 7,793 USDA SR Legacy foods on the device with word-order-free search; recipe editing offline with live nutrition, sources, oil disclosures and % of FDA Daily Values; batch sync with conflict choices; planned meals and eaten logs kept separate with day and 7-day views; cook mode with the cook's own steps, timers and cited safe temperatures; report an issue from every screen with an offline queue; account isolation and deletion.
- **Tests:** 86 unit/API tests and 20 Playwright journeys (10 journeys × desktop, mobile) passing with `pnpm verify`. Details in `docs/test-evidence.md`.
- **Blocked or open:** production (owner approval, privacy notice P3, email provider confirmation S5), food photography licenses (P5), curated cooking-method guides (needs sourced content), admin triage console.
- **Ledger:** `docs/requirements-ledger.md`.
