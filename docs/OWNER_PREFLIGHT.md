# Owner preflight

**Status:** draft for owner review · **Prepared:** 2026-10-19 · **Docs version:** 3.4

This is the one consolidated list of things only the owner (Gabriel, GitHub `gacuchac`) can supply or approve before and during the build. Everything else the agent discovers or decides itself. Nothing billable has been created, and nothing in this file is a secret.

Rules this list follows: `START_HERE.md` (required first step), `AGENTS.md` (preflight, budget approval, `.env` and secret-handling contract). Variable details live in [`config-inventory.md`](config-inventory.md); the template is [`/.env.example`](../.env.example).

## Environment audit (discovered, no owner action)

| Item | Finding | Checked by |
|---|---|---|
| Repository | `gacuchac/the_better_plate`, default branch `main`, docs only (no app code). | `git log`, file listing |
| Repository visibility | **Public** (owner decided to keep it public, see N2). | GitHub (earlier project thread) |
| Branch protection | **None on `main`**; history was force-pushed once during setup. | GitHub (earlier project thread) |
| CI | No `.github/workflows/` yet. | file listing |
| Agent push access | Works via the Claude GitHub App (commits pushed to `main` on 2026-10-19). | `git push` |
| Local toolchain | Node 22, pnpm 10, Python 3.13, PostgreSQL 16 server (cluster `16/main`, stopped until needed), Playwright 1.56 with Chromium. Docker CLI present but no Docker daemon, so local services run natively, not in containers. No Railway CLI, no secret scanner installed. 4 CPUs, 15 GB RAM, ~31 GB free disk. | `--version`, `docker info`, `pg_lsclusters`, `nproc`, `free`, `df` |
| `.gitignore` | Ignores `.env`, `.env.*` (keeps `*.example`), `*.pem`, `*.p12`, `*service-account*.json`. | file read |
| Secrets in repo | None found; `.env.example` holds names only. | file read |

Conclusion: **local development, tests and screenshot QA can start once N1 is approved;** N2–N4 are already settled. The installed PostgreSQL 16 serves local development and tests; the USDA public bulk download needs no key.

## Needed now (before implementation starts)

| # | Item | Why | Owner action and mechanism | Verification | Cost | Status |
|---|---|---|---|---|---|---|
| N1 | **Approve this preflight** and the default plan: local-only development until staging is approved. | `AGENTS.md` requires preflight before implementation. | Reply "approved" (or with changes) in the project thread. | Recorded in this file's status line. | None | Pending |
| N2 | **Repository visibility: stay public.** | Decided by Gabriel on 2026-10-19 (keep public, $0, free unlimited Actions minutes). Consequences the agent applies: no secrets ever committed (CI secret scanning), QA screenshots/traces never committed (`artifacts/` is git-ignored), and since Actions artifacts on a public repo are downloadable by any signed-in GitHub user, CI artifacts contain only synthetic test accounts and data and use short retention. | None further. | Repo page shows "Public"; `git check-ignore artifacts/qa/x.png` succeeds. | None | **Decided** |
| N3 | **Protect `main` with a branch ruleset.** | Prevents force-pushes and unreviewed changes now that agents push code. On a free personal account this works because the repo is public. | GitHub → Settings → Rules → New branch ruleset targeting the default branch: **Restrict deletions**, **Block force pushes**, **Require a pull request before merging** with **0 required approvals** (so you can merge your own PRs). **Later step:** add **Require status checks** once CI has run and the agent names the checks. Agent works on `claude/*` branches and opens PRs. | A direct `git push` to `main` is rejected. | None | **Done** 2026-10-19 (targets default branch); status checks pending CI |
| N4 | **Language: TypeScript end to end.** | Decided by Gabriel on 2026-10-19. The deterministic nutrition engine must give identical results offline in the browser and on server revalidation (`PRODUCT.md` §3), so one shared TypeScript library serves both. Python stays available for data tooling (e.g. USDA import scripts). Runtime and framework details go in ADR-001. | None further. | ADR-001 records it. | None | **Decided** |

## Needed for staging (before the first cloud deploy)

| # | Item | Why | Owner action and mechanism | Verification | Cost | Status |
|---|---|---|---|---|---|---|
| S1 | **Railway account and workspace** with a payment method on the Hobby plan. | Free plan (0.5 GB RAM, 1 replica, $1 credit) cannot run API + web + PostgreSQL. Trial is a one-time $5 grant. | Sign up at railway.com yourself; add a payment method; choose Hobby. Do not share login credentials with the agent. | Agent sees the workspace only after S3. | **$5/month minimum** (includes $5 usage) | Pending |
| S2 | **Approve the monthly cap and environments** (see cost model below). | `AGENTS.md` budget approval step 4. | Reply with: cap (recommended **soft alert $10, hard limit $25**), on-demand staging (recommended) or persistent staging. Set the limits yourself in Railway → Workspace → Usage. | Screenshot or statement that limits are set; agent re-checks via Railway dashboard or CLI once it has access. | Sets the ceiling | Pending |
| S3 | **Railway deploy token for CI.** | GitHub Actions deploys to staging. | Create a **project token scoped to the staging environment** in Railway; store it as a GitHub *environment* secret (`staging` environment), never in chat. Use OIDC instead if Railway offers it at setup time. | CI job `railway status` (or equivalent) succeeds; token never appears in logs. | None | Pending |
| S4 | **GitHub environments.** | Separate staging and production secrets; production needs a manual approval gate. | Create environments `staging` and `production`; on `production` add yourself as required reviewer. | Deploy job pauses for approval on `production`. | None | Pending |
| S5 | **Transactional email provider account** (for sign-up verification and recovery). | Email verification is required by `PRODUCT.md` §2.1. The agent will pick a vetted auth library or provider in ADR-002; either way an email sender is needed. | Create an account with the provider named in ADR-002 (candidates will be compared on free tier, deliverability, EU/US data location); put its API key in Railway staging variables yourself. Staging may use the provider's sandbox/test sender. | Test sign-up email arrives at an address you control. | Expected $0 at pilot volume if a free tier fits; verify at signup | Pending |
| S6 | **USDA FoodData Central API key** (api.data.gov). | Online food search and lookups beyond the starter bundle. The starter catalog is built from the public bulk download and needs no key. `DEMO_KEY` is limited to 30 requests/hour and 50/day per IP. | Request a free key at api.data.gov using your email; store it in Railway variables (server only). Keys posted publicly get deactivated. | API call returns 200 with the key; default limit is 1,000 requests/hour. | Free | Pending |

## Needed for production (before public pilot launch)

| # | Item | Why | Owner action and mechanism | Verification | Cost | Status |
|---|---|---|---|---|---|---|
| P1 | **Domain name** you control. | Production email sending needs a verified sender domain (SPF/DKIM/DMARC); PWA needs a stable HTTPS origin. Railway's generated domain works for staging only. | Buy or reuse a domain; tell the agent which subdomains to use. | `dig` shows records; HTTPS loads on the domain. | Registrar fee (typically ~$10–20/year; verify) | Pending |
| P2 | **DNS changes.** | Point app/API subdomains to Railway; add email auth records. | Add the records the agent lists, at your registrar. | DNS checks and email provider shows domain verified. | None | Pending |
| P3 | **Privacy notice, terms, adults-only policy.** | `PRODUCT.md` §2.1 and §5; consent events need a versioned notice. | Agent drafts; **counsel or you approve**. The agent cannot claim legal compliance. | Approved version recorded in `docs/privacy-data-map.md`. | Legal fees if counsel used | Pending |
| P4 | **Privacy/health-data legal assessment.** | `PRODUCT.md` §5: GDPR/state privacy applicability and FTC health/privacy assessment require counsel. | Engage counsel or record your decision to defer and its risk. | Recorded in `docs/risks-and-blockers.md`. | Possible | Pending |
| P5 | **Food photography source and licenses.** | Product is photography-led; every image needs license/provenance. | Choose: your own photos, licensed stock (name the source), or later AI generation via BYOK. | Licenses listed in `docs/data-provenance.md`. | Depends on source | Pending |
| P6 | **Production promotion approval.** | `AGENTS.md`: production needs QA evidence, migration review, flag-off checks and owner approval. | Approve each promotion via the GitHub `production` environment gate. | Approval visible on the workflow run. | Production usage (see model) | Pending |
| P7 | **Production Railway token and secrets.** | Separate from staging. | Create a production-scoped project token as a `production` environment secret; set production variables in Railway yourself or let the agent generate non-provider secrets (session secret, BYOK encryption key) directly into Railway. | Deploy succeeds; secrets absent from logs and bundles. | None | Pending |
| P8 | **Incident and support owner.** | Release checklist requires a named incident owner and a support contact for feedback reports. | Name the person and contact email (can be a forwarding alias). | Recorded in `docs/deploy-and-restore.md`. | None | Pending |
| P9 | **Backup restore drill sign-off.** | Release gate: restored-backup drill passed. | Agent runs the drill on staging; you confirm the report. | Drill report in `artifacts/qa/`. | Small backup storage | Pending |

## Optional / later

| # | Item | Why | Owner action | Cost | Status |
|---|---|---|---|---|---|
| O1 | Error monitoring account (e.g. a hosted error tracker). | Pilot can start with structured logs in Railway. Add when traffic warrants. | Approve a provider; add its DSN to Railway. | Usually a free tier; verify | Not needed yet |
| O2 | Object storage for feedback screenshots and images. | Pilot can store small, consented screenshots in PostgreSQL with size caps; revisit in an ADR if volume grows. | Approve provider if the ADR recommends one. | Possibly | Not needed yet |
| O3 | Your own OpenAI/Anthropic key **for testing** BYOK AI. | BYOK keys belong to each user and are stored encrypted per user, never in env vars. You only need one to test the feature yourself in the app. | Enter it in the app's settings once the feature exists. Never in chat or `.env`. | Provider usage you incur | Later milestone |
| O4 | Chef commerce approvals (payments, messaging, delivery). | Stays OFF publicly; built and tested privately with fake providers. Any real provider needs explicit approval and two-person sign-off. | None now. | — | Flags OFF |
| O5 | Spanish translation review. | P0 strings Spanish-ready; a native reviewer improves quality. | Name a reviewer if you want one. | — | Optional |

## Cost model (Railway, verified 2026-10-19)

**Prices used**, from [docs.railway.com/pricing/plans](https://docs.railway.com/pricing/plans) on 2026-10-19: Hobby $5/month including $5 usage; RAM $10/GB-month; CPU $20/vCPU-month; volume $0.15/GB-month; egress $0.05/GB; builds free; backups billed at volume rate on incremental size. Usage is metered per minute on actual consumption, not allocation. These are mutable: re-verify before approving S2.

**Assumptions:** one Railway workspace on Hobby; API service, web service (static PWA), PostgreSQL with a volume and daily backups. No separate worker for the pilot: import jobs run as one-off/cron runs; a worker is added only if measurements require it. Pilot traffic is small (hundreds of users at most).

| Environment | Low | Expected | High | Notes |
|---|---|---|---|---|
| Local development | $0 | $0 | $0 | Local PostgreSQL 16; no cloud. |
| Staging, **on-demand** (recommended) | $0 | ~$1 | ~$3 | Spun up for release candidates and E2E runs (~10–30 hours/month), then torn down; isolated database seeded from fixtures. |
| Staging, persistent | ~$3 | ~$6 | ~$10 | Always on with sleep-when-idle enabled; only if you prefer it. |
| Production | ~$4 | ~$8 | ~$32 | Expected: API 0.25 GB / 0.03 vCPU (~$3.10), web 0.08 GB (~$1.00), PostgreSQL 0.25 GB + 1 GB volume + backups (~$3.20), 10 GB egress ($0.50). High: two API replicas, 0.75 GB database, a worker, 50 GB egress. |
| **Monthly bill** (Hobby, on-demand staging) | **$5** | **~$9** | **~$35** | Bill = $5 subscription or usage, whichever is higher. |

**Recommended approval:** Hobby plan; on-demand staging; production only after P1–P9; **soft alert $10, hard limit $25/month**. Caution: Railway's hard limit takes *all* workloads offline when reached, including production. If you prefer availability over a strict ceiling, use only the soft alert plus a higher hard limit.

Other recurring costs outside Railway: domain (P1), email provider beyond its free tier (S5), counsel (P3/P4). GitHub Actions is free and unminuted because the repo is public.

## Two-pass testing gate (owner decision, 2026-10-19)

Every change that will be deployed passes the same tests twice, locally first and then on the web host:

1. **Local pass (always first).** Serve the full stack locally (API, web, local PostgreSQL 16). Run the API/contract suite and the full Playwright journeys on desktop and mobile viewports, with ordered screenshots and traces, and inspect them. A failure stops the deploy.
2. **Hosted pass.** Only after the local pass is green, deploy the same commit to staging on Railway (on-demand) and rerun the same Playwright suite against the deployed URLs, with its own screenshots and traces.
3. **Production** is promoted only after both passes are green and the owner approves (P6), followed by a production smoke test.

Each pass saves evidence under `artifacts/qa/<milestone>/<run-id>/local/` and `.../staging/` (git-ignored; synthetic data only). Until staging is approved (S1–S4), only the local pass can run, and deployment is reported as blocked, not complete.

## What the agent will do without asking

Local implementation in small tested slices, ADRs, the requirements ledger, CI workflows (lint, typecheck, tests, OpenAPI checks, secret scanning with an open-source scanner), the local pass of the two-pass testing gate, and PRs to `main`. It will not create accounts, add payment methods, deploy, configure DNS, accept legal terms or enable chef features.
