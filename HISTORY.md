> ARCHIVED, NONBINDING: The Cloudflare-first infrastructure decision, older F/I/J headings, and requirements-traceability.md filename below are superseded by PRODUCT.md v3.4 and AGENTS.md v3.4. Do not interpret these as missing active sections or use them to override Railway-preferred hosting.

# THE BETTER PLATE — HISTORICAL SPECIFICATIONS AND DECISION LOG

**Archive; NOT active coding instructions.** This file preserves the complete v2 document, including the original 36-section specification. The current authoritative requirements live in `PRODUCT.md`; execution and autonomy rules live in `AGENTS.md`. Conflicts are always resolved in favor of those current documents. Do not blindly execute this file's dated framework, cloud, demographic, chef-commerce, or milestone commands.

## Previously explored, not mandated

Cloudflare Workers/D1/R2; managed Node/Fastify/PostgreSQL; Next.js/React; fixed M0–M13 milestones; exact REST paths; IndexedDB; specific coding conventions; provider-specific crypto and queue suggestions. These are useful evidence and candidate designs, not restrictions on an autonomous agent. Preserve compatible product edge cases when implementing.

---

# THE BETTER PLATE — EXECUTABLE PRODUCT & ENGINEERING SPECIFICATION

**Version:** 2.0 · **Date:** 2026-10-18 · **Status:** build-ready plan, NOT an implemented application.  
**Audience:** Autonomous coding agent, product owner, reviewers.  
**Mission:** Create an elegant, trustworthy, offline-first cooking and nutrition education application, **free to all public users at launch**, while privately building feature-flagged chef workflows for release only after proper approvals.

> ## ONE-SHOT CODING AGENT DIRECTIVE
> You own implementation end-to-end in this repository. Follow **this document from top to bottom**, working in short vertical slices. First inspect tools, repository, credentials and runtime. Make a gap ledger. Implement the public product and privately test gated future features, with real integrations where authorized; use explicitly labeled local fixtures otherwise. After every slice: run unit/API/security tests, execute browser E2E, **save and inspect ordered screenshots**, run full previous regression, record evidence, commit/checkpoint, then continue. Never mark a module complete from code review alone. Never invent verified nutritional sources, compliance approvals, available API credentials, live deployment, or passing test results. If an external dependency blocks delivery, leave a reproducible working local/staging implementation and an explicit blocked-dependencies report. **Do not ask for routine architectural choices; follow the decisions here.** External account setup, spending, DNS changes, public release, real payments, and legal sign-offs require actual authorization. No deploy claim without verification.

---

## A. Authoritative decisions & precedence

The following are the latest product decisions and **override contradictory language anywhere in the historical original requirements preserved in Appendix Z**.

1. **Primary experience:** “Your Kitchen” local-first home, with starter foods, favorites, recipes, cooking instruction templates, planned and consumed logs; offline editing with IndexedDB and durable batch sync. Internet is needed for non-cached catalog search, initial auth, share-link publication, provider AI and image generation.
2. **Public launch:** Free; no ads, subscriptions, in-app purchases or chef transactions. Read-only, revocable, UUID-based recipe sharing works, with native share, SMS and email handoff outside the app. All other chef inquiries, inbox, order, checkout, fulfillment, delivery and internal administration should be designed and implemented as separate modules **OFF for public accounts** and tested with mock systems in staging. Launch readiness ≠ feature enabled.
3. **Minimum account data:** Email required, display name optional, planned meals and explicitly marked consumed meals. Collect only essential authentication, security, consent and operational metadata in addition. **No phone, address, height, weight, date of birth, diagnosis, or medical history in public onboarding.** No implicit sensitive profile collection from users' optional freeform text; manage privacy appropriately. User may configure non-identifying food preferences without expanding the base account profile. Adult-only initial service with age-appropriate access policy without compulsory DOB collection.
4. **Communication:** All explanations are general cooking/nutrition education. No diagnosis, treatment, personal dietetics services, promises of nutritional adequacy, “deficient” judgments, or medical claims. Targets clearly labeled general reference values or user-selected goals, not uniquely calculated requirements. Third-party sources do not remove our responsibility for calculations, accuracy, safety and privacy. Do not claim blanket immunity, unlimited future use of identifiable user data, or regulatory exemption because the app is free.
5. **Scientific integrity:** USDA FoodData Central and other authoritative composition sources; NIH ODS, National Academies, FDA, WHO, established guidelines and checked scholarly articles for educational claims. Provenance down to food/nutrient/claim, source URL, version and retrieval date. **Measured vs calculated vs estimated vs unavailable** visible via progressive disclosure. Unknown ≠ zero; planned ≠ consumed; intake gap ≠ physiological deficiency. No fabricated citations or source-backed health promises.
6. **Cooking:** Full cooking instructions without AI; method education (boil, steam, roast, fry, air-fry, grill etc.), temperatures, time ranges, ingredient-method compatibility, cooking yield, nutrient retention, oil added/retained/consumed, raw-vs-cooked portion definition, and food safety guidance. Never double-count absorbed oil when using a USDA cooked/fried record. No invented retention factors.
7. **AI:** Optional BYOK OpenAI or Anthropic agent with explicit scopes, server-side encrypted secrets, validated tools, preview/diff and approvals. Users without keys retain complete core experience. Only supported image providers generate AI images; no false Claude image-generation claims. Clearly mark photorealistic recipe image generation as illustrative.
8. **Design:** Bright, calm, futuristic minimalism inspired by Apple/Tesla—not a copy of either. Real photography or photorealistic food images only, no cartoons/food mascots. Plain English, inclusive and nonjudgmental, first view simple; optional depth and citations one or two taps away. Core tasks targeted at <=3 **screen changes**, without trading away important safety confirmations.
9. **Engineering:** Independently deployable frontend and an **API-first backend modular monolith** with public versioned REST/OpenAPI contracts. A monorepo is fine. Avoid Next.js as the canonical backend and avoid premature microservices. Use strict TypeScript, deterministic shared nutrition logic, local testing of backend independently of UI.
10. **Infrastructure choice is deliberately gated:** **Prefer a Cloudflare-only free-tier proof of concept**, using static React/Vite frontend, Hono/Workers API, D1/SQLite, R2; only accept after checking real USDA starter-catalog import size, Workers CPU limits, D1 read/write/capacity, multi-account auth, offline sync, tested durable background work, and provider support. If the proof fails, preserve the public OpenAPI/domain contracts and use separately deployed **Next.js + Fastify + managed PostgreSQL** (e.g. Vercel/Cloud Run/Neon) as the documented fallback. **Do not silently pretend both database stacks are interchangeable without migration work.** The owner has not committed to a provider, so produce a scored proof-of-concept and record the selected implementation in ADR-001 before expanding the app.
11. **Quality:** Build small slice → automate backend tests → integrate UI → Playwright ordered screenshots and traces → inspect visual evidence → full cumulative regression → checkpoint. Release-block on critical failures or missing evidence. Always-available Report Issue control; user's reviewed opt-in screenshot plus scrubbed recent activity and correlation ID.
12. **Safety/privacy:** Authorize every operation server-side, even when feature flags are OFF/ON client-side. No user raw data in unnecessary analytics/replay, no secrets or sensitive content in logs, and no automatic transfer of private recipe logs to chef module. Implement privacy and legal review gates before releasing chef transactions, optional advanced health connections, or secondary personal-data usage.

### Critical precedence rule
Sections **A–N** specify the authoritative deliverable. Appendix Z preserves every pre-existing requirement for traceability. A requirement from Appendix Z applies **only if it does not conflict** with Sections A–N. In particular, Appendix Z references to Next.js-as-backend, mandatory demographics, Supabase Auth, PostgreSQL-specific tables, in-app chef commerce at public launch, phone/address, and universal launch of expensive P0 features are **superseded as described above**. Keep a `docs/requirements-traceability.md` mapping Appendix features to implemented/gated/deferred status.

---

## B. Definition of product and user journeys

**Users:** adults who want enjoyable food, simple cooking education and estimated nutrition exploration; busy students, home cooks, athletes, kosher-aware households and curious learners. Avoid assuming diets are medical treatment. Existing private-chef business is a separate operational relationship.

**Primary journeys (<=3 navigational transitions):**

| Journey | Starting place → completion | Offline? | Release |
|---|---|---|---|
| Create from favorites | Your Kitchen → New recipe → edit ingredients/portions/method/oil → save | Yes after initial data download | Public |
| Explore nutrients | Recipe → live totals → expand nutrient source/evidence | Yes with cached citations | Public |
| Plan or log meal | Your Kitchen → recipe → plan/mark eaten explicitly | Yes; sync later | Public |
| Find new food | Ingredient search → local results, online results if connected → cache | Local only offline | Public |
| Follow instructions | Recipe → Cook → method-specific steps, timers, safety | Yes for cached recipes | Public |
| Share recipe | Recipe → review redacted snapshot → publish UUID / native share | Publishing needs internet | Public |
| AI modification | Recipe → Companion overlay → preview diff → approve | No | Public optional BYOK |
| Report issue | Anywhere → issue sheet prefilled with activity → preview screenshot → submit | Queue offline until approved sync | Public |
| Chef quote/order | Recipe → controlled inquiry → quote → payment/order | No | Internal staging only until release gates |

**Navigation:** four public destinations: Your Kitchen (home), Create, Explore, You; nested kitchen areas Ingredients, Recipes, Meal Plan, Sync. Responsive mobile bottom nav and desktop rail. Persistent unobtrusive Report issue action and contextual AI companion overlay. No invisible controls or maze of dialogs. Avoid cart/checkout teasers when gated OFF.

**First run:** public landing → sign up with email, optional name → simple preference/safety information (no clinical profile) → starter-catalog installed indicator → Your Kitchen. Let a guest browse public examples but do not silently associate local personal records with a new account without clear import/consent.

**Polish:** plain conversational microcopy, empty/loading/error/offline states designed, inclusive color contrast, keyboard/mobile/touch support, readable measures/units; at most one strong CTA per context; calm nutrition visualization. Food images must have licensing/provenance, correct ingredient depiction, signed access for private ones. AI images need clear labels.

---

## C. Functional domains and contracts

### C1. Identity and privacy
Email verification, authentication and recovery through vetted provider compatible with selected hosting; passkeys/OIDC as feasible, admin MFA mandatory. Session revocation, safe CSRF/cookies/CORS, per-record ownership, rate limiting, deletion/export, privacy notice versions and consent events. No phone/address fields public; no collecting data for future disabled capabilities. Clear local account data on logout/account changes. Exclude children under 13; adults-only product policy, no unnecessary date-of-birth capture.

### C2. Food Knowledge Base
Official USDA ingestion of normalized food records with canonical external IDs, food type and state, nutrient IDs, per-100g unit, portions and density, source/version/URL/retrieval date, completeness and missing flags, allergen uncertainty and kosher-status non-certification. Start with 100–200 packaged, versioned starter foods, selectively expand to 300–500 curated foods, then user-demand catalog. Source data must be properly imported; do not use invented nutrient figures outside labeled test fixtures. Source manifests and delta updates. Search index, offline favorites/recent caches, online-only missing items, batch lookup.

### C3. Deterministic Nutrition Engine
Typed pure functions for amounts and units; recipe sum per ingredient/serving; cooked/raw yield and official retention factors; measured discarded or retained oils, added sauces, recipe state. Return known/missing per nutrient with quality and provenance; preserve historical source snapshots. Support reference Daily Values vs properly labeled general DRI categories; don't assume user demographics. Daily and seven-day views strictly separate plans from logs, and preserve partially logged days as incomplete. No invented body absorption, dosage, nutrient remediation, or false “complete nutrition” guarantee.

### C4. Cooking Knowledge Base & Guidance
Curated ingredient × method templates with description, equipment, temperature/time range, thermometry, unsafe methods exclusion, prep order, cook timing, safe handling, storage; method names raw, boiled, steamed, pan-fried, deep-fried, air-fried, baked, roasted, grilled, sautéed, stir-fried, microwaved, braised, and other approved entries from Appendix Z. Plain-language why/how differences; meals editable by method, oil type/volume/mass, raw vs cooked measurement. Tested curated instructions accessible without AI; untested combinations clearly marked. Cooking-mode offline and screenshot-tested.

### C5. Local-first Your Kitchen
Versioned bundle of starter food records and offline cooking instructions, delivered as static/cached assets; IndexedDB local records for downloaded foods, favorites, recipes and meal plans/logs, and durable outbox. Local-first transactional saving and browser refresh persistence. In-memory hot cache for currently active ingredients. Default locally calculated live updates without per-keystroke APIs. Storage quota/eviction recovery, privacy isolation on account switch, manual export of unsynced drafts.

### C6. Sync engine
`POST /v1/sync/batch` with bounded operations, UUID idempotency keys, per-operation statuses, conflict and server version metadata, ordered entity dependencies; pull via cursor and tombstones. Coalesce superseded edits but not separate meal-consumption events. Sync online at app resume, reconnection, short debounce after meaningful changes, or user Sync now. Never claim cloud sync before acknowledgement. Conflict UI offers keep local/cloud/both; don't silently overwrite. Optional background sync cannot be relied upon if app closed.

### C7. Recommendations and educational claims
Constraints-first deterministic recommendation ranking; avoid allergen assumptions, dietary conflicts and medical claims. Explain why a candidate fits a user-selected goal; offer swaps not prescriptions. Evidence claim registry with source, exact URL/DOI when checked, publisher, retrieved/reviewed date, evidence type, editorial version. Trusted server ingestion and citation verification, scheduled freshness checks; never make “live verified” claim if offline/cached. Each nutrient has friendly basic explanation and optional scientific details. Flag sources whose scientific guidance varies by population.

### C8. AI Companion (optional BYOK)
Secure provider-key entry/test/disconnect, encrypted at rest, never expose provider keys to browser/local storage/logs; support OpenAI and Anthropic through provider adapters. AI tools are typed, bounded, authorization and flag checked; suggested edits, substitutions, navigation, meal plans and cooking instructions are reviewable proposals, not automatic mutations. No client/LLM ability to run arbitrary internal HTTP/database commands. Prompt-injection red teaming. Rate/cost budget user controls; compatible image provider adapter for photorealistic recipe images, generated-image disclosures, recipe-image provenance, no guarantee of exact appearance. Non-AI fallback complete.

### C9. Recipe share and social
Revocable read-only recipe snapshots with unguessable UUID public link, scoped shared fields and expiry if configured; no dietary history, user identity, private email or AI key. Sanitize and validate rich text; link creation online only; native web share with copy/SMS/email fallback. Public metadata image and Instagram-compatible native share where supported, not an unsupported direct-post promise. Warn any link holder can read until revoked. Support independent recipe revision and snapshot lifetime.

### C10. Chef module, private future capability
Implement modular interfaces and staging-tested customer inquiry, chef messaging, quote, preparation scheduling, order/payment/refunds, delivery and staff console behind default-OFF flags. Public users initially have only external link sharing. Future opt-in data (delivery address/phone/payment) must be collected just-in-time after legal/privacy/operational approval, not in current accounts. Strong server enforcement of OFF, staged allowlist, two-person approval for regulated/high-impact features, audit logs, kill switch, and rollback obligations. Use fake providers and test data for unreleased systems.

### C11. Feedback, support and observability
Persistent report button on every public and admin screen, including error states. Allow bug, general feedback, suggestion. Show prepopulated user-readable event sequence (e.g. opened favorites → salmon recipe → swapped broccoli for cauliflower → save failed) without raw keystrokes, health logs, secrets or unintended content. Optional user-approved screenshot with privacy mask/preview/remove. Send correlation ID, sanitized stack/exception, app/build version, route and device class. Support offline queued reports and admin triage statuses. Traces, rate/latency metrics, errors and resource budgets with data minimization.

---

## D. API-first architecture and interfaces

**Backend is the system of record.** OpenAPI 3.1 checked into repository, versioned REST `/v1` API; generated typed browser/client library, machine-readable examples, strong runtime validation, public API docs with redacted examples. Backend can be tested with curl/Postman/HTTP integration suite before any screen exists. No UI-only authoritative business logic; shared pure nutrition library can calculate locally but server revalidates on save/sync.

**Public endpoints (illustrative initial contract):**

```
GET    /v1/health/live
GET    /v1/health/ready
GET    /v1/catalog/manifest
GET    /v1/foods?query=&cursor=&limit=
POST   /v1/foods/batch
GET    /v1/foods/{foodId}
GET    /v1/nutrients/{nutrientId}/education
GET    /v1/recipes
POST   /v1/recipes
GET    /v1/recipes/{recipeId}
PATCH  /v1/recipes/{recipeId}         # revision/ETag required
POST   /v1/recipes/calculate          # pure preview where needed
POST   /v1/sync/batch
GET    /v1/sync/changes?cursor=
POST   /v1/recipes/{recipeId}/share   # explicit review, online
GET    /v1/shared/{shareUuid}        # only approved snapshot fields
DELETE /v1/shares/{shareUuid}
POST   /v1/feedback
GET    /v1/me
DELETE /v1/me
GET    /v1/admin/flags                # admin only
POST   /v1/admin/flags/{key}/stage    # staged, not automatic release
POST   /v1/agent/proposals            # BYOK and validated scopes
POST   /v1/agent/proposals/{id}/approve
```

All routes have authorization, anti-abuse limits, predictable structured errors, request IDs, schema types and tests. Auth endpoints depend on vetted authentication provider; do not invent unauthenticated production endpoints. Reconcile actual paths with generated OpenAPI schema before shipping.

**Backend module structure:** identity, catalog, nutrients, recipe, cooking, logging, planning, sync, education/evidence, recommendation, AI, sharing, feedback, flags, admin, chef (OFF). Each owns its tables and API contracts; cross-module operations use typed application services, not direct unrestricted table access. No microservice gateway, distributed event mesh, or Kubernetes.

**Concurrency & jobs:** asynchronous I/O for web requests; durable retry/idempotency-aware background operations for source imports, image generation, audits and notifications. Workers/Queues/Workflows platform-specific adapter. No unbounded work on constrained request runtime. No repeated backend calls for ingredient sliders; preloaded ingredient records drive local computations. Instrument real CPU and DB budgets.

---

## E. Data schema requirements (logical, implementation agnostic)

- Identity: `users`, `profiles`, `sessions/provider_refs`, `privacy_notices`, `consent_events`.
- Catalog: `food_sources`, `food_items`, `food_portions`, `nutrients`, `food_nutrients`, `ingredient_aliases`, `catalog_manifests`, `source_revisions`.
- Cooking: `methods`, `ingredient_method_rules`, `recipe_instruction_templates`, `yield_factors`, `retention_factors`, `food_safety_sources`.
- Personal kitchen: `user_favorite_foods`, `recipes`, immutable `recipe_revisions`, `recipe_ingredients`, `planned_meals`, immutable/idempotent `consumption_events`, `sync_operations`, `sync_cursors`, `deletion_tombstones`.
- Education: `evidence_sources`, `evidence_claims`, `recommendation_rules`, `educational_content`.
- AI: encrypted `ai_credentials`, `ai_threads`, `ai_proposals`, `ai_usage`, `generated_images`.
- Sharing: `share_snapshots`, `share_revisions`, `share_revocations`.
- Operations: `feedback_reports`, `activity_summaries`, `audit_events`, `feature_flags`, `flag_approvals`.
- Unreleased chef: `chef_inquiries`, `chef_messages`, `chef_quotes`, `chef_orders`, `chef_fulfillment`, `chef_payments`, `chef_delivery`; isolated, protected and never accessed by public OFF flow.

Use stable UUIDs, version/time columns, indexes for ownership/date/query, immutable nutrition snapshots, referential integrity, safe migrations, privacy deletion/export, source attribution and per-user scoping. SQLite/D1 implementation uses explicit constraints and transactions fitting D1 semantics; PostgreSQL fallback has independently validated migration/locking design. No fake synchronous cross-database transaction assumption.

---

## F. Hosting architecture decision record — POC MUST HAPPEN FIRST

**Candidate A — Cloudflare-only $0 eligible pilot** (not guaranteed $0): React/Vite static app with PWA assets; independent Hono API on Workers; D1 SQLite; R2 media/evidence; appropriate managed queue/cron capabilities, as supported by current provider docs and limits. Entire stack inside one provider, no server OS maintenance, low network complexity. Test Worker CPU limits for deterministic nutrition, food-data import overhead, auth/BYOK secret-handling, offline sync and database limits. Observe free-tier boundaries and deny/upgrade safely rather than exhaust silently. If a feature can't satisfy the proof on free plan, record blocker and choose paid capacity or Candidate B explicitly.

**Candidate B — portable managed Node/Postgres**: Next.js frontend deployed independently, Fastify + TypeScript API in a managed container runtime, managed PostgreSQL, managed object storage and job adapter. Avoid maintaining virtual machines. Good compatibility with original technical plan; extra providers/cross-cloud overhead can be mitigated by same-cloud services and nearby regions. Do not choose solely for hypothetical scale.

**Hard ADR-001 acceptance:** implement API health, user account boundary, 150 verified starter foods with source metadata, indexed ingredient search, deterministic recipe calculation, offline edits and sync, and test with 20/100/1000 DAU simulated mixes. Measure Worker request CPU, rows read/written, storage, latency/cold starts, code/runtime restrictions, source imports, auth/secret isolation, and sustained load. Record costs, limitations, selected provider, migration strategy, and owner decision. **No assertion that a Cloudflare Workers runtime supports every Node/Fastify feature without verification.** Optimize to direct browser→API calls with CORS/CSRF security, avoid unnecessary frontend BFF round trips. Background jobs and DB access must be bounded.

---

## G. Security, privacy, regulatory and evidence controls

Threat-model public sharing, user data exposure, CSRF/XSS, injection, malicious recipe imports, SSRF, BYOK key theft, AI prompt injection, weak roles, malicious upload, D1 cost amplification, stale offline sessions, and flag bypass. Validate all inputs, HTML sanitize, use HTTPS/HSTS/CSP, encrypted secrets, least-privilege admin, log redaction, access audits, rate limiting and dependency scans. No raw captures of private diaries in third-party replay products; screenshot uploads optional and explicit. Do not use personal data for unrestricted unidentified future purposes. GDPR/state privacy applicability and FTC health/privacy assessment require counsel based on actual service/data flows. No claim that free pricing or citation to USDA transfers all legal responsibility. The app is educational, non-clinical and adult-targeted. Clearly state uncertainty, no treatment or guaranteed outcomes.

Source composition data vs health claims vs cooking-safety instructions have independent source review and version controls. Include evidence provenance and expiry policies. A source reference is not equivalent to a live verified source; offline copy carries last checked date. Track image licenses, whether generated, and user permissions.

---

## H. Visual design and interaction acceptance

- 4 root destinations; 3-screen-transition core task target; contextual editing and sheets preferred to new pages.
- Warm white `#FAFBF9`, white surfaces `#FFFFFF`, deep charcoal `#17211E`, restrained sage `#719B87`, accessible neutral grays. Avoid decorative gradients, dense cards, cartoon produce, whimsical mascots and uncontrolled colors. Use clean typography (Inter or appropriately licensed system font); 44px-ish touch targets.
- Real food photography or realistic images, truthful ingredient depiction, editorial light and realistic portion sizes; label AI-generated images, never promise exact appearance.
- Simple default nutrient bars with *Estimated* cue; optional “Learn” and “Sources” drawers. Avoid misleading single “nutrient completeness” score. Unknown not colored as zero; levels against reference aren't diagnoses.
- Short copy, no guilt/shame/red warning for treats. Show precise sync statuses “Saved on this device”, “Syncing”, “Synced”, “Needs attention”, and a legible offline search limitation.
- Accessibility WCAG 2.2 AA target, reduced-motion support, keyboard/screen reader labels, high contrast; English primary and Spanish-ready content keys (translate P0 where reasonably feasible and test). Tests on narrow/mobile and desktop layouts.

---

## I. Quality and evidence: mandatory at EVERY milestone

**The unit of progress is one working, tested, screenshot-documented vertical slice.** The agent must not generate all features and test once at the end.

1. Write acceptance cases and initial failing tests from contract.
2. Implement one small backend slice, including migration, source evidence, API contract, authorization.
3. Run unit, property/edge, API integration and negative/security tests directly without UI. Keep recorded JSON/JUnit reports.
4. Build frontend against actual API; automate Playwright Chrome/mobile viewport flows. Screenshot before/after each meaningful state, modals, errors, async changes, and entire content if needed; record trace and optionally video, sanitized.
5. **Inspect screenshots** for overflow, collisions, readability, tap targets, visual consistency, accidental cartoon imagery and unwanted PII. Compare approved baselines; never rubber-stamp differences.
6. Run full cumulative tests from every prior milestone including online/offline, flags OFF, multi-device sync, a11y and screenshots. Fix before proceeding.
7. Save checkpoint with commit hash, artifact manifest, screenshots/traces, failures/fixes, approved baseline and rollout state. Update requirements matrix and issue ledger.

**Outputs:** `artifacts/qa/<milestone>/<run-id>/` with `screenshots/`, `traces/`, `videos/` if enabled, `api-results/`, `coverage/`, `a11y/`, `visual-diffs/`, `manifest.json`, `report.html`; protect and redact personal information, set retention policy. Provide a browsable report linking action timeline and images, and a release checklist. A pass without required screenshot evidence is NOT a pass. API-only test steps use JSON assertions/logs, not fake UI screenshots.

**Failure testing:** unsupported offline ingredient, missing source, nutrient unit conversions, conflicting recipe versions, auth expiry, local storage eviction, failed/retried sync, stale flag/client, upload rejection, missing AI key, external API outage, link revocation, concurrent writes, DB migration/recovery, 429/5xx and data redaction. Test that disabled chef endpoints deny requests despite forged frontend state.

---

## J. Mandatory build sequence and gates

| Gate | Vertical slice | Direct API and data acceptance | Playwright screenshot acceptance |
|---|---|---|---|
| M0 | Repo + infrastructure POC | OpenAPI, health, chosen ADR, CI, basic database, 150 real catalog entries, performance sample | Landing + mobile shell; full offline shell |
| M1 | Auth + local identity | Verify/restore/session/roles, deletion skeleton, security negative tests | Signup/login/recovery, errors, phone layouts |
| M2 | Your Kitchen starter catalog | Manifest/records/attribution, IndexedDB download and search | Offline catalog and source modal |
| M3 | Nutrition core | All units/missing/coverage/math/oil/retention property tests | Ingredient portion controls updating live bars |
| M4 | Recipe editor + offline persistence | Revision validation, API CRUD, immutable snapshots, IndexedDB drafts | Create/edit/undo/refresh without network |
| M5 | Batch sync + conflicts | Idempotent sync, cursor, two-device edits, no lost consumption events | Saved/local/sync/conflict/error flows |
| M6 | Cooking methods + guidance | Ingredient compatibility, source safety, oil mass accounting, no invented factors | Method comparison, instructions, offline cooking mode |
| M7 | Meals + weekly tracker | Planned≠consumed, timezone/DST, incomplete log detection | Week dashboard and learning drawers |
| M8 | Suggestions + evidence | Evidence registry, source freshness, rules, dietary/uncertainty safety | Simple explanations, sources, recommendations |
| M9 | Sharing + beautiful images | Read-only snapshot, UUID revocation, licensing/gen labeling | Share previews/mobile native fallback, photoreal photos |
| M10 | Optional BYOK AI | Secret handling, tool permissions, preview/approve, negative tests | Proposal/diff/approval, offline/unconfigured states |
| M11 | Feedback + admin + analytics | Scrubbed recent actions, consent for screenshot, issue API | One-tap report from every route, screenshots |
| M12 | Feature-gated chef modules | All endpoints deny OFF, admin approvals, simulated transactions, kill switch | Private ON and public OFF screenshot matrix |
| M13 | Production hardening | Backup restores, version/migration, load/limits, security review | Full desktop/mobile/online/offline regression |

**Important sequencing:** The always-accessible Feedback button shell, analytics safety, source attribution, and feature flags OFF are built into M0/M1 and expanded through M11/M12; never delay basic reporting or disabling protections until the later feature gate. Backend-first API implementation precedes visual UI for each milestone; build/discover/new backend tools only after tests of prior slice pass. M12 can be fully staging-tested without a public chef release. All production deployment subject to credentials and legal gates.

---

## K. Final test catalog and release checklist

**Contract tests:** OpenAPI validates actual API responses; consistent pagination/versioning/errors, auth enforcement, rate limits, no accidental direct DB bypass. USDA identifiers and labels tested against imported, attributed records. All deterministic calculation tests include missing nutrient, fractional servings, raw/cooked weights, oil added vs retained, fried-entry double count, partial weekly logs, timezone changes, official source updates and historical preservation.

**Security tests:** unauthorized cross-user recipe access, leaked public link fields, stolen/revoked share, XSS on recipe names, CSRF, source SSRF, key exfiltration, prompt injection, forged feature flags, admin permission escalation, sensitive screenshot capture. Keys never in JS bundles, browser IndexedDB, or telemetry.

**Offline/sync tests:** cold first load online, repeat load airplane mode, starter catalog access, local recipe edits, device reboot/refresh, duplicate queued operations, reconnect storms, partial batch success, two devices editing same recipe, explicit merge choices, account switching, quota eviction, offline report approval, active link creation requiring network.

**Release readiness:** zero critical/high unresolved security issues; QA evidence bundle complete and inspected; product analytics minimal and privacy reviewed; documented risk and source-quality gaps; restored-backup drill passed; rollback runbook verified; production smoke tests and monitoring complete; free-tier budget alerts active; legal/privacy review gate recorded; public feature flags OFF for chef operations; operational incident owner identified. Never represent product as released merely because local tests succeed.

---

## L. Repository, artifacts and operator playbook

Suggested provider-neutral monorepo (adapt folder naming to runtime):

```
the-better-plate/
  apps/web/                  # mobile-first PWA frontend
  apps/api/                  # independent /v1 API modular monolith
  apps/worker/               # managed asynchronous job adapters if needed
  packages/contracts/       # versioned OpenAPI, schemas, generated clients
  packages/nutrition-core/  # pure tested arithmetic and source model
  packages/cooking-core/    # templates and method rules
  packages/ui/              # minimal design tokens, reusable accessible parts
  packages/offline-sync/    # IndexedDB + outbox + reconciliation
  infra/                    # documented provider IaC/config, env templates
  docs/                     # ADRs, decisions, provenance, privacy, operator guides
  tests/api/ tests/e2e/ tests/load/ tests/security/
  artifacts/qa/             # CI output (gitignored, securely retained)
```

Scripts: `lint`, `typecheck`, `test:unit`, `test:api`, `test:integration`, `test:e2e`, `test:visual`, `test:offline`, `test:security`, `test:load`, `build`, `dev`, `db:migrate`, `db:seed:official`, `db:backup-check`, `qa:report`, `verify:release`. Commands documented and runnable in CI. Secrets from managed secret stores; sample `.env.example` uses placeholders. Local dev available without production provider keys. Maintain `docs/decision-log.md`, `docs/api.md`, `docs/sources.md`, `docs/privacy-data-map.md`, `docs/feature-flags.md`, `docs/requirements-traceability.md`, `docs/deploy.md`, `docs/restore.md`.

---

## M. Final output contract for coding agent

On completion deliver **actual repository source**, reproducible `README`, OpenAPI spec and generated client, migrations/import procedures, local offline demonstration, screenshot/trace evidence, source provenance manifest, unit/API/E2E/security/load results, admin feature-flag controls and audit evidence, runbook for backup/restore, deployment URLs only when truly deployed, and an honest feature/status matrix: `public-ready`, `staging-only`, `blocked`, `deferred`. Summarize free-tier usage estimates and observed measurements. Include all missing external accounts, keys, legal approvals and unknowns in `docs/blockers.md`.

**Evidence before assertion:** A feature is not complete merely because a page is rendered or a database table exists. A provider integration is not complete with mock-only behavior. If hosted systems are inaccessible, deliver a tested local/staging implementation, not fabricated successful results. The code must retain the public free/offline experience even if chef modules and AI integrations are disabled.

---

## N. Agent execution checklist (copy as a command)

```text
Read this entire specification, including Appendix Z for detailed edge cases.
Resolve conflicts using Sections A–N precedence. Start by generating:
1. requirements-traceability.md and status matrix;
2. ADR-001 comparing Cloudflare POC with fallback architecture;
3. repository structure, OpenAPI contract, minimal local build and CI;
4. milestone test/evidence plan with screenshot names and release gates.
Then execute milestones M0–M13 sequentially. For each: implement the backend API
first, test it, implement the UI against the real API, capture AND INSPECT
ordered Playwright screenshots/traces, run the ENTIRE cumulative regression,
fix failures, save a checkpoint and report measurements. Never skip a gate.
Public release = free, privacy-minimal, local-first; future chef workflows OFF.
No invented nutritional data, citations, approvals, secret keys, screenshots,
API test successes or deployment claims. At the end supply code, instructions,
evidence, blockers, tests and accurate release status.
```

---

# Appendix Z — Original 36-Section Master Specification (Preserved Verbatim)

The original accumulated build spec is retained below **verbatim** so no detailed previously requested requirements are lost. The newer Sections A–N above organize implementation and resolve changed decisions. When old instructions conflict, Sections A–N take precedence.

# THE BETTER PLATE — MASTER BUILD SPECIFICATION AND ONE-SHOT IMPLEMENTATION PROMPT
Version 1.0 • 18 October 2026 • Owner: private-chef business founder • Status: implementation specification, not a claim that application is built or deployed.

> INSTRUCTIONS TO CODING AGENT: Build, test, document, and, only with required credentials and permission, deploy an actual production-quality mobile-first PWA called **The Better Plate**. This document is the source of truth. Implement in vertical slices; don't substitute static screens or mock flows for functional features. Do not claim that a feature works without a passing test. Do not invent third-party API availability, data, citations, or successful deployment. If access keys or accounts are unavailable, ship the fully functional local/staging implementation using clearly labeled dev fixtures and a deployment runbook; report the remaining external setup accurately. Never publish secrets. Make pragmatic decisions without unnecessary clarification and log assumptions.

## 0. Purpose and non-negotiable product principles
Build an inviting, minimalist, bright nutrition-centered experience connecting customizable meals, real-time macro/micronutrient calculations, understandable daily and weekly nutrition insights, safe meal recommendations, AI agent control through BYOK OpenAI or Anthropic Claude, verified and cited nutrition knowledge, recipe visualization, social share cards, privacy-preserving recipe snapshot sharing by link, email, or SMS (with chef services entirely outside the app). Brand working name: The Better Plate (legal clearance pending); sibling brand The Better Party. Serve kosher-aware and other dietary preferences without claiming automatic kosher certification.

Non-negotiable: (1) never let an LLM invent nutrient composition; (2) authoritative food database IDs, provenance, units, freshness, and nutrient coverage; (3) missing nutrient != 0; (4) planned != consumed; (5) under target != diagnosed deficiency; (6) minimize data and provide robust privacy; (7) users remain in control of agent actions; (8) accessible, fast UX without an AI key; (9) the app is entirely free; no in-app chef inquiries, payments, orders, fulfillment or user-to-external-chef messaging; (10) each health/science claim has directly relevant attributable evidence with source and date; no fabricated citations. Give users a delightful food experience, not an anxiety-producing red/yellow shame dashboard.

## 1. Personas and core jobs to be done
A. Busy student: build tasty, healthy dinner quickly, reuse favorites, understand nutrients; optional sharing of a recipe with a chef outside the app.
B. Recreational athlete: flexible protein/macronutrient targets, high-fiber foods, weekly meal prep; no false performance guarantees.
C. Kosher household: preferences for kosher-eligible menu options, separation of meat/dairy, ingredients/brands review, allergies, Shabbat planning; human approval of actual certification.
D. Nutrition-curious learner: understand iron, fiber, calcium, vitamin D with citations, no medical diagnosis.
E. Founder/chef/admin: manage vetted recipe catalog, product content, source reviews, customer access, and feedback without reading users' complete private logs by default.

## 2. Scope, releases and explicit out-of-scope
P0 / ship first: public landing, account auth, onboarding, preference/goal settings, food search, recipe builder with editable portions and real-time calculator, daily/weekly dashboard, planned/eaten tracking, ingredient swaps, saved recipes, explainable rules-based suggested meals, citation/source drawers, BYOK companion with bounded tools, optional recipe images via compatible model, AI disabled graceful mode, revocable share-link snapshots with native SMS/email sharing, share images/web share, admin console, tests, audit logs, deployment configuration.
P1 / feature-flag: grocery list, meal plan templates, pantry inventory, recipe import from URLs with user review,  richer educational library, reminder preferences, recipe community opt-in, household mode.
P2: companion multimodal vision, barcode/photo recognition with correction, Apple Health/Health Connect optional data ingest, clinician/dietitian collaboration with relevant legal review, advanced evidence synthesis, native mobile apps with deeper Instagram sharing, professional account publishing as allowed by Meta.
Do not pretend P1/P2 are complete if only scaffolded. Ship P0 truly working.

## 3. Experience and information architecture
Unauthenticated: `/` landing, `/explore` limited recipes, `/about`, `/evidence`, `/login`, `/signup`, `/privacy`, `/terms`, `/accessibility`.
Authenticated mobile bottom tabs: **Today**, **Build**, **Discover**, **Week**. Profile and Companion floating accessible controls; desktop left rail. Routes `/app/today`, `/app/build`, `/app/recipes`, `/app/recipes/:id`, `/app/week`, `/app/companion`, `/app/settings`, `/app/settings/ai`, `/app/settings/privacy`, `/app/education`, `/app/sources`.
Admin routes `/admin/users`, `/admin/food-data`, `/admin/evidence`, `/admin/content`, `/admin/audit`, `/admin/operations`.
Use elegant editorial food imagery, warm white background, pale sage, citrus/yellow accent, subtle teal, restrained typography, rounded cards, generous space, WCAG AA text contrast, no green-only status signaling; light and optional dark theme. Navigation max 5 bottom tabs. Size controls >=44x44 px. All interactions keyboard-accessible, screen-reader labeled. Support English and Spanish from day one with i18n translation keys, locale-aware measurement units; RTL readiness not necessary P0.

### Screens, content, states
- Onboarding: 2-minute progressive flow: dietary preferences (vegetarian/vegan/kosher-aware/dairy-free/gluten-free etc.), medically serious food allergens with explicit caution, dislikes, cooking skill, time/budget, nutritional focus ('balanced meals', 'more fiber', 'higher protein', 'explore nutrition') and optional demographics for individualized reference targets. Never require weight, medical status, height or birthdate just to use basic recipe creation. Consent before storing sensitive health disclosures. Under-18: restrict/deny self-service until child privacy/legal design completed; launch for adults only. Pregnancy/lactation, chronic conditions and eating-disorder risk: use additional safe guidance, refrain from automated restrictive nutrition prescriptions and suggest qualified professional input.
- Today: greeting, attractive hero recipe, planned vs consumed segmented toggle, meaningful macro chips, nutrient coverage visual with confidence denominator; "What would make today better?" gentle recommendations; quick add existing recipe, batch log, edit serving. Show whether user has logged enough to support an insight.
- Build: large visual recipe hero, ingredient search/add, ingredient rows with adjustable quantity and measure, cooked/raw toggle backed by correct food record and yield factors, +/- controls and direct-entry grams, undo/redo, snackbars, live totals under 200 ms for local operations where feasible, desktop split-pane view, mobile sticky macro ribbon with expandable micronutrient sheet. Ingredient edit recalculates instantly. Recipe includes title, servings, method, time, tags, allergens, notes. Distinguish recipe nutrient per batch vs per serving. Save version/draft autosave, mark prepared/eaten only when explicitly logged. No unsupported auto-generated nutrient numbers.
- Nutrient details: calories, protein, total carbohydrate, total fat, fiber, saturated fat, sodium, added sugar where known, and selected micro: iron, calcium, magnesium, potassium, zinc, vitamin C, vitamin D, folate, vitamin B12, vitamin A, vitamin E, thiamin, riboflavin, B6. Expandable full supported list and source coverage icons. A complete bar represents measured coverage for a specific reference goal, not completeness of all nutrients. Tooltips source, reference target, consumed amount, units, completeness and methodology. Avoid unbounded positive fill for nutrients with upper limits; excess is displayed distinctly, not celebrated.
- Week: Mon–Sun switchable date range, planned/consumed layers, time-weighted target comparison, per-day trend, average or appropriate interval logic per nutrient, coverage confidence, source uncertainty, suggested substitutions to improve varied eating pattern. Explicitly mark partial logging; no invented zero days.
- Discover: editorial recipe cards; filters for allergens, dietary style, cooking time, prep capacity, servings, macro range, food availability, chef-ready vs DIY; ranking reasons and user choice. No inference that generated imagery proves food safety or actual appearance.
- Chef sharing: a user explicitly creates a revocable public read-only snapshot with a randomly generated UUID token, previews included information, then copies the URL or invokes device sharing to SMS/email. The application does not collect chef requests, quotes, shipping information or order details.
- Help and Feedback: every screen offers issue reporting and product feedback. No direct user-to-external-chef messaging is present in the app.
- Companion: docked drawer + full conversation page, context of current recipe/planner, citation footnotes, diff previews, model + provider badge, tool execution timeline, "Review & apply" actions, accessible voice entry optional only if supported, transparent token spend and capped workflow depth.
- Share: generate branded square 1080x1080 and vertical 1080x1920 user-selected image with dish photo or illustrated card, recipe name, tasteful optional macro summary, small source line/QR; exclude health information unless separately opted in. Download PNG + copy link + Web Share API triggered by user click. Instagram opens through OS share sheet only if supported; never promise direct publishing to arbitrary personal accounts.
- Education: source-linked short cards for common nutrients with role, common food sources, what low intake can mean, limitations, source and review date. Later videos/articles gated by editorial review.

## 4. Technical stack and monorepo
Use pnpm + TypeScript strict monorepo:
- Next.js App Router (current supported stable at implementation), React, Tailwind CSS, shadcn/ui or Radix primitives, Lucide; next-intl localization; next-pwa equivalent maintained solution/service worker implemented carefully; server rendering + optimistic client edit state.
- Backend: Next.js route handlers or separately structured application service under `/packages/server`, with tRPC or typed REST/OpenAPI; Zod for validation and JSON schema tool args; OpenAPI docs. Prefer clear REST endpoints for external integrations.
- PostgreSQL 16+ with Prisma ORM and explicit migrations; pgvector optional P1, never necessary for nutrition arithmetic; Redis/Upstash for queues/rate limiting when available; durable job queue + transactional outbox for external provider tasks.
- Auth: hosted Supabase Auth or Auth.js integrated with trustworthy provider; choose one and implement end-to-end. Prefer Supabase Auth for hosted managed email verification, OAuth (Google/Apple if configured), MFA/TOTP, rate limiting, session revoke; application DB access via server; RLS defense-in-depth where using Supabase Postgres. Avoid rolling passwords or auth tokens.
- Storage: private S3-compatible bucket/Supabase Storage; per-user private assets with short-lived signed URLs, separate public generated images only upon consent.
- AI: adapter interfaces for OpenAI Responses API and Anthropic Messages/tool use APIs; official SDKs; server-side invocation only; dynamic verified model listings or maintained allowlist; structured tool schemas. Optional OpenAI image-generation adapter; no false Claude-native image generation.
- Food data: USDA FoodData Central official API through server adapter and cache. Typed upstream mapping, normalized per-100-gram fields, source URLs, FDC identifier, data type/version/retrieval date, branded vs foundation distinction. Seed a limited curated canonical food set for offline/dev demos that is either genuinely imported through API and attributed or clearly marked synthetic fixtures excluded from real recommendations. Never ship fake nutrition as real.
- Evidence: official NIH ODS, FDA, WHO, National Academies DRIs and USDA/HHS guidance references; PubMed/Crossref for peer-reviewed metadata and DOI verified against actual article metadata. A claim registry backed by editorial approval; background refresh and link-check jobs. Avoid indiscriminately treating preprints as equivalent to guidelines.
- Observability: Sentry or OpenTelemetry, privacy-safe structured application logs, request IDs, operational dashboards; no secrets or medical details in logs; consent-aware analytics (Plausible/PostHog privacy-appropriate).
- Email: transactional provider via server (Resend/Postmark); direct messages live via authenticated polling or realtime channel with strict access controls; notifications without revealing sensitive information in push/email bodies.
- Test: Vitest unit/integration, Playwright E2E, axe accessibility, contract tests with mock provider responses, OWASP security negative tests, deterministic test fixtures.
- CI/CD: GitHub Actions lint/types/test/build/scan/deploy; Vercel or comparable runtime + managed PostgreSQL; staging and production separated; encrypted environments; Terraform optional not prerequisite. Containerized local docker compose for DB/Redis.

## 5. Core data model: required tables and constraints
Tables: users (auth external id, status, created_at), profiles (display_name, locale, timezone, onboarding), dietary_preferences (user id, preferences, allergens, consent), nutrition_goals (user, version, energy/protein/fiber etc., sources, personalization basis, effective dates), ai_credentials (user, provider, ciphertext, key_version, last_four_metadata_only, created/revoked_at), ai_usage (provider/model, units/cost estimate/status, no secret), food_sources (dataset/provider/url/version/license/retrieval date), food_items (canonical_name, branded_brand, data_type, fdc_id nullable unique scoped, raw/cooked status, density references, portions, allergens review status), food_nutrients (food_id, nutrient_id, per_100g numeric nullable, units, origin_id, precision/missing_reason, methodology), nutrients (canonical id, external mappings, category, unit, upper-limit relevant), nutrient_references (nutrient_id, demographic criteria, target_type RDA/AI/DV/UL, value, unit, source_id, effective_dates), recipes (user owner or catalog, title, steps, servings, tags, current_revision), recipe_revisions (immutable snapshot, calculated totals snapshot, source version, time), recipe_ingredients (revision, food id, grams, entered unit, prep state, yield/retention method, ordinal), meal_plan_entries (user, recipe revision, local date, meal slot, servings, status planned or consumed), consumption_events (user, recipe revision or food snapshot, amount, consumed_at, source, supersedes/idempotency), weekly_insights (versioned derivation, data coverage), evidence_sources (title/url/publisher/doi/version/published/reviewed_at, publication type), evidence_claims (claim text, claim type, citations, review status, jurisdiction and reviewed date), recommendations (version, input snapshot, rules, reasons, evidence references, uncertainty), ai_threads/ai_messages (user scoped, opt-in retention), agent_action_proposals (user, thread, typed action, JSON diff, status pending/approved/rejected/expired, hash and expiration), generated_images (owner, provider, prompt hash, original recipe revision, model, moderation, visibility, signed path), chef_inquiries (user, recipe revision, requested date/window, status, quote, consent snapshot), message_threads/messages (participants, text, attachments, read status), content_library (videos/articles, claim ids, review), share_cards (visibility, expiry/revocation), audit_events (actor, action, resource, timestamp, scrubbed diff), user_export_jobs, deletion_jobs, delivery_zones/config (admin controlled), feature_flags.
Enforce FK constraints, indexed user_id/date, unique idempotency key, unique source identifiers, tenant scoping, immutability for consumed recipe snapshots, soft-delete only where business/accounting law requires retention, cascading privacy deletion otherwise. Never trust a client-supplied user_id. All writes transactional with optimistic concurrency on recipe revisions.

## 6. Nutrition calculation specification (hard requirement)
Represent nutrient quantity in internal canonical unit per 100g edible portion (g, mg, µg, kcal, or IU only with scientifically verified conversion). Raw ingredient grams from standardized portion entry. Per ingredient contribution n = (grams / 100) * value_per_100g * verified_retention_factor when applicable; sums for recipe and divide by servings. If cooking yield transforms weight, model expected final yield and serving weight; do not naively retain raw density values after cooking. Where official raw/cooked entries exist prefer correct USDA entry to inferred factors. Label result as calculated estimate and explain yield/retention assumptions. No arbitrary rounding in computation; format display only.
Nutrient values: `known(value, unit, source, coverage)` or `missing(reason)`, never collapse null to 0. Partial sum known lower-bound NOT a measured complete total; show "at least X from Y/Z ingredients" or "incomplete data", not precise 100% of target. Calculate nutrient completeness by relevant ingredient contributions / authoritative source availability; explicitly disclose missing contributors. A food labeled 0 may mean measured zero or rounded-to-zero on FDA packaging; retain that distinction. Branded foods commonly lack full micro panel: expose missing coverage and preferentially suggest Foundation/FNDDS or alternate foods without silently substituting unverified values. Nutrient conversions validated and unit tested, including µg↔mg and vitamin D IU↔µg if supported. Label and recipe are different objects: do not market calculated recipes as legally compliant packaged-food Nutrition Facts labels.
Reference targets: users select standard FDA Daily Values for label-like view OR demographic-specific RDA/AI from vetted DRI; explain these are different. Reference coverage by age, applicable sex-based DRI reference categories, pregnancy/lactation if consensually entered, and clinical exclusions; never silently infer a sex or physiological category. Respect reference version/source/date. If personalization insufficient, display standard reference with label, not pretend individualized needs. Upper limits for some nutrients: do not optimize toward UL, show caution as appropriate; distinguish nutrients for which upper limit applies to supplements/fortified forms versus foods.
Daily/weekly: maintain time zone and DST. `planned` and `consumed` are separate, and weeks include seven local calendar days; do not treat missing logs as consumption of zero. Weekly per-day averages can aid flexible planning for some nutrients, but do not assert that missing yesterday's iron can always be "made up" tomorrow; avoid compensation advice where biology, safety or population differs. Track fiber, sodium, saturated fat and added sugar with distinct directional semantics, no universally "more is better". Be explicit that nutrient adequacy cannot be diagnosed from self-reported intake alone. Food allergen data from USDA may be incomplete: never certify allergen-free based only on missing allergen metadata. Kosher status cannot be inferred from nutrient composition and must be verified independently.

## 7. Recommendation engine
First implement deterministic, testable ranking/constraint engine independent of LLM. Candidate dishes drawn from curated catalog plus user saved recipes; filter hard constraints: verified allergen exclusions, dietary requirements, user hard preferences, available ingredients, time and servings. If allergen data uncertain exclude or flag prominently requiring manual confirmation. Rank by diversified food pattern, fit to specified nutritional targets, preparation constraints, user history/favorites, source coverage, variety, affordability if known; do not promote a single nutrient at the cost of unsafe excess or conflict. Explain each rec in plain language with underlying values and reference data. Provide "show why", "not for me", "use this substitute", and one-click add to plan. Avoid advice framed as disease treatment.
Optimizer optional: mixed-integer/linear programming for meal portion selection with nonlinear user preference safeguards and upper intake constraints, otherwise a transparent greedy bounded heuristic. Need not force exact 100% each day. Highlight practical combinations (e.g. spinach + vitamin C-containing food) with corresponding ODS source explanation and limitations. No automatic supplements or clinical guidance.

## 8. BYOK multi-provider companion: end-to-end contract
Connections: user selects OpenAI or Anthropic, creates API key in their own provider console, pastes once over TLS into secure server endpoint; encryption with envelope AES-256-GCM per user credential and KMS-held encryption key (or mature provider encrypted secrets), strictly no browser localStorage/sessionStorage/cookie plaintext, never return secret to client. Admin cannot view raw key. Key rotated/revoked/deleted, connection tested with a minimal inexpensive call only after user consent. Clear note that API billed by chosen provider and key usage is separate from consumer product subscriptions. Optional no-key guest can use deterministic companion suggestions without natural language chat; fail gracefully if key invalid/quota exhausted. Reject keys used to route to unapproved domains; use SSRF-safe fixed allowlisted provider endpoints. Bound usage (rate limit, token budget, maximum tool calls, timeout, optional monthly app-side cap; provider fees may still accrue). Usage ledger user-only.
Agent tools: `get_current_view`, `navigate(route_enum)`, `search_food(query)`, `get_food_nutrients(food_id)`, `get_nutrient_references(ids)`, `get_recipe(id)`, `list_saved_recipes`, `create_recipe_draft`, `propose_recipe_patch(recipe_rev, patch)`, `preview_nutrition(recipe_draft)`, `search_recipes(filters)`, `propose_plan_patch`, `get_week_summary(period,planned_or_consumed)`, `get_evidence(query)`, `explain_nutrient`, `generate_recipe_image` (only provider supported, explicit user request and cost disclosure), `draft_chef_inquiry`, `draft_message`, `create_share_card`. All tools have strict Zod JSON schema and fixed allowed fields/paths; every call reauthorizes current signed-in user; no shell/file access, no arbitrary SQL, no arbitrary fetch/URL navigation or DOM-level clicking. Model suggests a typed action; backend applies after validation and appropriate confirmation.
Read-only tools can execute automatically; navigation can execute locally with clear toast; recipe edits/plan changes first preview diff then explicit Apply or Undo (user setting can permit low-risk autosave with undo); sending message, recipe link sharing, image generation costs, publishing/sharing, deleting data, changing privacy/security settings, payment/order actions ALWAYS require explicit current-user confirmation for exactly the reviewed action payload. Hash and expire approvals. Request-scoped authenticated server context; deny cross-user object ids even if tool invents them. Max 6 tool actions per user message default, cycle detection, abort cancel.
Prompt injection: all retrieved docs, food titles, recipe descriptions, webpage text, user messages, and tool output are untrusted data. Separate them from system and developer policy, enforce per-tool permissions in server, output sanitization and schema validation, never disclose secrets, never allow sources to provide instructions. Threat test indirect injection via malicious recipe text or published source.
Context: current route, recipe draft/revision, selected targets, dietary constraints and logged coverage only as required for request; never send full health profile unnecessarily. User sees "Data shared with AI provider" settings and consent, retention deletion option. Stream explanations and structured tool events. Conversation memory is scoped to user, bounded, deletable. Prompt "Your macros" answers from read tools, not creative arithmetic.
Image generation: OpenAI image generation adapter for users with an eligible OpenAI API key and model, or separately configured supported image service with its own user consent. Anthropic alone cannot create images. Image prompt derives from verified ingredient names, cooking method, portions and meal styling, no unrealistic ingredient addition; display "AI-generated concept, not actual dish" watermark/caption; guard against unsafe/illicit content; optimize CDN format; cache only if user consent and license/terms permit; generation may be inaccurate visually, never use image to infer nutrition. Repeated image generation requires cost confirmation.

## 9. Evidence, citations and live-grounding pipeline
Truth hierarchy:
(A) ingredient nutrient composition — USDA FoodData Central API (or legally compliant manufacturer/verified label records when provided). Show numeric amount + USDA FDC record identifier, food data type, unit, per-100g basis and retrieval date. If unavailable state unknown; no model estimates disguised as sourced data.
(B) individual intake references — NIH Office of Dietary Supplements and National Academies Dietary Reference Intakes; FDA DVs only for *label-style* interpretations, not individualized targets; official source version.
(C) general dietary guidelines — current USDA/HHS Dietary Guidelines for Americans, WHO official guidelines, with geography applicability and date.
(D) health explanations — NIH ODS/CDC/NHS or similar recognized public health resources; specific peer-reviewed journals indexed PubMed with DOI, publication date, evidence hierarchy, limits; include systematic review/guideline when relevant. Publication date alone is not quality evidence. If papers contradict, express uncertainty and strength of evidence.
Source retrieval: an allowlisted evidence connector to official APIs and verified publisher URLs; periodically refresh records + claim review job and on-demand live validation for time-sensitive claims, with provenance event, fetch timestamp and content hash. Use PubMed E-utilities or Crossref for identifier verification rather than LLM-fabricated citations; use PubMed articles' abstracts/metadata and legal publisher access without bypassing paywalls. Every factual health claim links to a directly relevant source, ideally sentence/paragraph-level claim registry. If live source is inaccessible: show last-verified date and source link, "not reverified live"; do not claim live verification. Cache with TTL: food composition by record revision, guideline/ref by periodic version scan, research claim refresh and invalidation on source changes. All source links checked nightly in production; broken links flagged to editors.
Evidence ingestion pipeline: retrieve -> provenance capture -> parse/sanitize -> de-duplicate -> metadata validation -> mapping to claim -> machine QA -> human review for medical/clinical-impact claims -> publish -> refresh/downgrade if outdated. Protect against prompt injection in source pages. Present a "Why this suggestion?" sheet with calculated values, source metadata, reference thresholds, uncertainty, and public URLs. No fabricated citations even if AI provides them; citations must resolve to approved DB entries.
Nutrient education example for iron: role in oxygen transport, food sources and non-heme absorption nuances sourced to NIH ODS; explain that inadequate dietary intake does not prove deficiency, symptoms are not diagnostic, and concerns about iron deficiency require professional testing, not supplementation advice. For comparisons between studies cite each and avoid medical prescriptive language.

## 10. Social / Instagram integration
P0: user-triggered Web Share API for image/URL where browser supports, PNG export, copy caption and link, privacy preview for share card. Browser or operating system chooses destination; do not claim a programmatic way to force a personal Instagram account to publish. Link preview/OG card for publicly consented share links and ability to revoke URL. A PWA does not guarantee Instagram Stories direct app transfer on every platform.
P2: separately evaluate current Meta Instagram Graph API publishing, eligibility and app review. Professional/creator accounts have API distinctions, permissions, and restrictions; consumer personal accounts must never be falsely promised API publishing. Native iOS/Android Story share SDK mechanisms only if officially supported/approved. User always confirms exact content and destination; no silent posting. Prevent shared nutrient data, age, pregnancy status or health profile from appearing by default. De-identify aggregated comparisons.

## 11. Chef service and communications
Single chef admin is an explicit role, not a backdoor superuser. Public recipe catalog separate from private user food diary. Send custom recipe + servings + dietary notes only after granular user consent; send to authenticated chef inbox via transactional write. Inquiry lifecycle: draft -> submitted -> reviewing -> quoted -> accepted/declined -> fulfilled/canceled (quote acceptance requires explicit action; payment deferred until configured). Chef can reply securely, revise quote and discuss modifications, set availability and geographic service area; sanitize free text, scan uploads, enforce message rate limits. No automated guarantees of kosher compliance, kitchen permits, allergen safety, or health outcomes. Display "Prices and availability confirmed after review". P1 Stripe payment intents, tax, receipts, refunds and webhooks with signatures/idempotency; never invent amounts.
Notifications: in-app and opt-in email, transactional email verification, avoid sensitive subject lines or push text, allow quiet hours/unsubscribe except essential account security. Support export of inquiry threads.

## 12. Threat model, security/privacy and compliance
Adult-only MVP, age gate plus privacy notice. Treat diet/allergy/nutrition history as sensitive even if HIPAA generally does not apply to a consumer wellness product; assess HIPAA separately if partnering with covered entities. Consult legal counsel on FTC health claims/Health Breach Notification Rule, MA consumer privacy and commercial food/service rules, other jurisdictions, GDPR/CCPA as applicable, FDA boundaries, and kosher assertions. Do not label app medically certified or HIPAA-compliant without valid assessment. Clearly mark "general educational information, not medical diagnosis or personalized clinical advice"; design actual safeguards beyond disclaimer.
Authentication: email verification, MFA option, short secure sessions, HttpOnly Secure SameSite cookies, CSRF protection for state-changing browser requests, credential stuffing protection, CAPTCHA only on abuse, password reset single-use, OAuth PKCE, login anomaly alerts and sign-out-all. Authorization: all endpoints server-side ownership checks, row-level security if supported, role-based and resource-based permissions, regular IDOR tests. Least privilege service tokens, no client service-role key.
Data: TLS, encryption-at-rest, app-level encryption BYOK secrets with KMS, tenant separation, retention controls, user account/data export/delete, encrypted backups, recovery procedure, data processing agreements for third-party AI vendors, user opt-in before sending dietary personal data to an AI provider, minimize collection. PII masked logs and error reports; audited admin actions, secure object uploads/mime sniffing/size limit and virus scanning for attachments; rate limits, WAF, CSP, HSTS, secure headers, dependency lockfiles and vulnerability scanning. Domain allowlists for all provider requests, secure image proxy, prohibit SSRF. Strict HTML sanitation and no untrusted JSX injection.
Threats covered: account takeover, key disclosure, agent tool privilege escalation, prompt injection from USDA-derived text/recipe titles/source websites, poisoning of nutrition database, false labels, unsafe allergen claims, plan overreach, storage URL leakage, social accidental public post, admin curiosity, cross-tenant queries, excessive token spend and denial-of-wallet, replay of approvals, CSRF, SSRF, cross-site scripting, uncontrolled webhook duplicates. Incident playbook: isolate, revoke keys, notify users where required, restore, postmortem.

## 13. API contract (typed REST or tRPC equivalent)
Auth: `POST /api/auth/...` through selected hosted auth. Profile `GET/PATCH /api/me`, `POST /api/me/export`, `DELETE /api/me` (confirm + async purge). Food `GET /api/foods/search?q=`, `GET /api/foods/:id`, `GET /api/foods/:id/nutrients`, `POST /api/foods/resolve` (validate portion). Recipes `GET/POST /api/recipes`, `GET/PATCH /api/recipes/:id` with revision/If-Match; `POST /api/recipes/:id/clone`, `POST /api/nutrition/preview` with structured ingredients; `POST /api/recipes/:id/share-card`; log `POST /api/intake` with idempotency key; weekly `GET /api/summary?from=&to=&mode=`; references `GET /api/references?profileVersion=`; recommendations `POST /api/recommendations` with filters; evidence `GET /api/evidence/:claimId`, `GET /api/evidence/sources/:id`; AI `POST /api/ai/credentials`, `POST /api/ai/test`, `DELETE /api/ai/credentials/:provider`, `GET /api/ai/models`, `POST /api/ai/chat` streaming, `POST /api/ai/actions/:id/approve|reject`, `POST /api/ai/image` guarded; chef `POST /api/chef/inquiries`, `GET /api/chef/inquiries`, `POST /api/threads/:id/messages`, read/list threads; admin content/food/evidence CRUD gated by role and audit.
Validate every input with schema; idempotent state transitions and proper 401/403/404/409/422/429; avoid user enumeration. Paginate search, rate-limit upstream and cache safely. Include OpenAPI spec and typed generated client and concise error envelopes with correlation ID. Realtime sends only authorized thread topics.

## 14. UX acceptance criteria
- Logged-out can explore sample recipes but can't see personal data.
- First-use creates a meal within three minutes without mandatory AI key or biometric data.
- Every ingredient adjust updates deterministic nutrient summary immediately, with correct serving scaling, and preserved edit undo.
- Source drawer always reveals authoritative numeric record or explicit unknown; tooltip correctly separates FDA DV from demographic-specific RDA/AI.
- Distinct planned/eaten switch; consuming recipe records immutable nutrient snapshot when logged.
- Partial weekly food log can't be summarized as nutrient deficiency; says incomplete and asks user to complete records.
- Hard allergen exclusion never ranks foods with unverified allergen status as safe; kosher flag requires human/product verification.
- AI companion can navigate and propose changes, and does not send/charge/share without explicit approval.
- Claude BYOK text flow works; image generation disabled/redirected unless independently configured provider supports it; OpenAI key test and image flow covered.
- Meal inquiry sends only consented fields to chef; private messaging is strictly thread-participant access-controlled.
- Share card includes only selected fields, mobile share feature detected with PNG fallback, no promised personal-account Instagram direct post.
- Evidence-linked explanations use verified claim records, not model-manufactured references.
- Accessible mobile 360px width; no horizontal scroll; supported desktop 1440px; reduced-motion, screen reader and keyboard flows.

## 15. Functional and security test matrix
Unit: nutrient math for grams/servings, null vs zero, micro conversions, raw vs cooked yield, fractional portions, rounding only at view, high sodium limiting, UL semantics, reference category lookup, DST date rollover, safe empty weeks; recipe edit revision conflicts; source link mapping and DOI validation; ranking hard constraints; URI allowlist and tool schema validation.
Integration: USDA happy/429/404/missing nutrient and retry/caching; credential encrypt/decrypt/revoke, no secret in logs; OpenAI and Anthropic tool-call cycles with fake SDKs; evidence ingestion stale/offline and false source IDs; chef thread lifecycle; export/delete; notifications and retries; real provider contract smoke only when test API keys supplied.
E2E: create user/verify/login/forgot password; goal onboarding; search real sourced ingredient; build/edit/save; toggle planned vs consumed; see weekly totals; use companion to change recipe and approve; refuse malicious prompt-injection recipe; create/revoke recipe share link; verify anonymous read-only snapshot; share card PNG; disconnect AI; delete account; anonymous and second-user IDOR denial; a11y audit. Test permutations for narrow/mobile, desktop, dark/light and both languages.
Security: OWASP ASVS and Agentic AI threat tests, dependency scan, SQL injection/XSS/CSRF/SSRF, direct ID access, expired/reused approval, signed URL expiration, role escalation, API key exfil attempts, rate-limit/token cost cap, fuzz unexpected nulls, dynamic tool schema validation. Add load smoke with realistic concurrent queries and provider outages; fast degraded UI, not infinite spinner. CI fail on high-severity vulnerabilities unless tracked and approved; never bypass checks for deployment.
Performance SLO aspirations (measure under representative environment): p75 initial page interactive <=2.5s on modern mobile network, local nutrient update perceived instant (<200ms), P95 common API cached response <700ms, crash-free sessions >99.5%, complete server-side errors with correlation IDs. Accessibility WCAG 2.2 AA targeted and verified.

## 16. Repo structure and scripts
```
/apps/web                 Next.js frontend + route handlers
/packages/db              Prisma schema, migrations, seed
/packages/nutrition       deterministic calculator, tests
/packages/food-data       USDA adapter/cache/normalization
/packages/evidence        source registry, claim validation
/packages/recommender     rules and test corpus
/packages/ai              providers, tool schemas, approval engine
/packages/ui              shared components/design tokens
/packages/contracts       Zod schemas, OpenAPI types
/packages/config          feature flags, security env validation
/infra                    docker compose, deployment config
/tests/e2e                Playwright
/docs                     ADRs, security model, runbooks, editorial rules
```
Scripts: `pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm db:migrate`, `pnpm db:seed:dev`, `pnpm security:scan`, `pnpm evidence:validate`, `pnpm deploy:check`. `.env.example` with explicit variables, never real credentials. Docker compose brings up local Postgres/Redis and optional mail catcher. README provides click-by-click cloud configuration, migrations, staging/production, domain DNS, HTTPS, rollbacks, backup recovery, key rotation and on-call response.

## 17. Environment variable specification
DATABASE_URL, DIRECT_DATABASE_URL, AUTH_PUBLIC_URL, AUTH_SECRET or SUPABASE_URL/ANON_KEY/SERVICE_ROLE_SERVER_ONLY (selected auth implementation), KMS_KEY_ID, ENCRYPTION_MASTER_KEY_DEV_ONLY, USDA_FDC_API_KEY, PUBMED_EMAIL/NCBI_API_KEY optional, ALLOWED_SOURCE_DOMAINS, APP_BASE_URL, STORAGE_BUCKET_PRIVATE, STORAGE_BUCKET_PUBLIC, STORAGE_SERVER_CREDENTIALS, REDIS_URL, EMAIL_API_KEY, EMAIL_FROM, SENTRY_DSN, FEATURE_CHEF_ORDERS, FEATURE_IMAGES, FEATURE_AI_COMPANION, MAX_AI_REQUESTS_PER_DAY, MAX_AGENT_STEPS, MAX_IMAGE_CALLS_PER_DAY, PUBLIC_ANALYTICS_ID optional, STRIPE_SECRET_KEY/WEBHOOK_SECRET feature-flagged P1. Validate variables at startup; distinguish mandatory for local vs production; production refuses insecure/dev encryption or auth settings. OpenAI/Claude user keys live encrypted in database, never static production env variables except optional organization development test keys.

## 18. Admin editorial & operating dashboard
Only role-authorized operator can curate trusted canonical foods, reconcile USDA duplicate records and serving portions, approve recipe catalog images/content, inspect failed source refresh jobs, verify citations/date/DOI, approve educational copy, manage inquiry statuses and customer threads, configure available delivery zones/lead times, disable unsafe foods or recommendations, inspect aggregate privacy-safe engagement metrics. Source claims that fail verification are quarantined until editorial review. Never allow admin to impersonate a user or see their BYOK secrets. Show consent-based, limited meal details inside inquiry, not full food diary.

## 19. Product analytics, feedback and economics
Privacy-preserving events: onboarding completion, first recipe built, first saved, returning weekly planner, ingredient swaps, nutrient detail opens, source clicks, companion opt-in, approval vs rejection, inquiry submitted/quoted/accepted; record opt-in and don't send sensitive recipe/health values to analytics. Dashboard metrics: activation within 7 days, WAU/MAU, 4-week retention, recipe saves per active user, recommendation adoption, evidence-link trust metrics, AI spend opt-in %, cost per AI task, support response time. Instruments include user feedback "was this helpful?" and "incorrect food data" reporting with curator triage. The entire app is free with no in-app premium services; don't charge consumers for basic nutrient truth. BYOK user's own provider charges disclosed separately.

## 20. Delivery plan and milestone gates
M0 scaffold, design system, auth + typed schema, CI, local setup and baseline security. M1 USDA adapter, food search, recipe builder + deterministic calculator, source drawer and test corpus. M2 planned/consumed log, targets, week dashboard, rec engine and educational claim registry. M3 BYOK encryption, provider adapters, tool call/approval engine, image provider opt-in and UI. M4 chef inbox/inquiries, share cards, admin panel and localization. M5 Playwright/security/accessibility/load checks, production-safe data policies, staging, real provider smoke tests. M6 production deployment only with provided deployer credentials, DNS, privacy/terms and food-business/legal review completed; report actual endpoints, smoke results, monitoring and rollback. Build small deployable increments, never sacrifice non-negotiable integrity for superficial completeness.

## 21. Source links for implementation verification
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- NIH nutrient recommendations: https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx
- NIH iron evidence: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- FDA food label guidance: https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/changes-nutrition-facts-label
- U.S. Dietary Guidelines 2025–2030: https://www.fna.usda.gov/cnpp/dietary-guidelines-americans
- OpenAI Responses API: https://developers.openai.com/api/reference/responses/overview
- OpenAI image generation: https://developers.openai.com/api/docs/guides/tools-image-generation
- Anthropic Claude tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Anthropic vision/image generation limit: https://platform.claude.com/docs/en/build-with-claude/vision
- OWASP prompt injection guidance: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- MDN Web Share: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API
- Meta official Postman Instagram API: https://www.postman.com/meta/instagram/folder/9cgqucg/instagram-api-with-facebook-login
At coding time verify current SDK methods, API scope restrictions, license conditions, nutritional recommendation updates and applicable laws; if source unavailable do not invent details.

## 22. Final deliverables from coding agent — required
1. Full runnable repository, no empty routes, broken imports, mock payments or placeholder nutrition masquerading as live.
2. `.env.example`, migrations, verified food import command, fixtures with clear synthetic flags and seeded recipes, auth and admin bootstrap guidance.
3. Deployment-ready staging build; production deployment *only* if access, consent, keys and required legal content exist. Show real URL only after success.
4. Screenshots of major flows at phone and desktop, architecture diagram as Mermaid, API/OpenAPI, ERD, data provenance documentation.
5. Passing lint/type/unit/integration/E2E/security and a11y logs, with honest results of tests not executable offline.
6. Detailed instructions for setting up USDA, OpenAI and Anthropic BYOK, image generation, transactional mail, database, hosting, domains, Instagram sharing behavior, monitoring and backups.
7. Honest gap register for third-party approvals/legal review/source coverage; feature flags for any blocked feature.
8. Test user journey from signup -> ingredient search -> build + edit -> validated nutritional data -> weekly plan -> agent modification + approval -> chef request -> two-way message -> share card.

## 23. Execution command to coding agent
**BEGIN IMPLEMENTATION NOW.** Read this entire specification, create task checklist in repo, implement vertical slices and continuously run tests. Prioritize a deployable secure MVP over half-working breadth. Use official provider docs and note exact verification date. If a requested integration cannot actually work as described, implement the closest compliant user experience with explicit limitations. Never invent nutrition, evidence, permissions, quotes or deployment outcomes. Finish by reporting completed features, passing/failed tests, what was actually deployed, any required credentials, known risks, and how to operate the product.

## 24. Authoritative ingredient knowledge base — detailed implementation addendum
The ingredient catalog is a first-class, locally queryable product data asset, not a collection of LLM-written JSON records. Import official USDA FoodData Central releases through a repeatable ingestion pipeline and use authenticated server-side USDA API requests for incremental retrieval. Source URLs: https://fdc.nal.usda.gov/ ; https://fdc.nal.usda.gov/api-guide/ ; https://fdc.nal.usda.gov/download-datasets/ . Do not require USDA API access in the browser. In production use a properly provisioned key and respect rate limits. Initial MVP should seed a useful curated catalog from actual USDA records, with common raw/cooked ingredients, rather than ingesting the entire large branded dataset on day one.

### 24.1 Required normalized entities
- `ingredient_catalog`: internal UUID, canonical food name, search aliases/synonyms, locale, USDA FDC ID, FDC data type (Foundation, SR Legacy, FNDDS, Branded), brand when relevant, raw/cooked/preparation state, edible portion policy, category, publication state, search rank, verified_at, created_at, updated_at.
- `nutrient_dictionary`: stable internal nutrient ID, source nutrient number/ID, canonical unit, supported display units, calculation methodology, precision rules, macro/micro grouping, target comparison semantics.
- `ingredient_nutrient_observations`: ingredient FK, nutrient FK, numeric amount per 100 g edible food or explicit `unknown`, raw upstream quantity/unit, reporting basis, record/source version, measurement/imputation/label flag where disclosed, data completeness reason, ingestion job FK; unique constraint per ingredient/nutrient/version.
- `ingredient_portion_conversions`: food FK, measure label (1 cup chopped, 1 tbsp, 1 medium piece), source-provided gram weight, confidence, source ID, validity date; only allow user-entered cup/piece conversions when a verified weight mapping exists, otherwise request grams.
- `ingredient_sources`: publisher, URL, FDC ID, dataset type, release timestamp, API fetched_at, immutable content hash, import job ID, attribution and license metadata. Preserve per-nutrient lineage if an observation originates from a different version or source.
- `ingredient_revisions`: immutable published snapshots with effective timestamps, diffs, quality reviewer, source link, and references from logged consumption events and recipe calculation snapshots.
- `food_substitution_mappings`: candidate replacement, culinary suitability, allergen/dietary suitability, nutrition effects recalculated on demand, evidence/provenance; never treat a similarity embedding as nutritional fact.
- `data_quality_flags`: anomalous values, duplicate food matches, ambiguous ingredient identity, incomplete nutrient panels, questionable unit mappings, stale food label, reviewer/resolution fields.

### 24.2 Import / reconciliation pipeline
1. Download or retrieve official feed, record exact timestamp/version, raw artifact SHA-256 and provenance; store raw upstream snapshot securely according to dataset terms.
2. Parse with schema-validated importer; retain USDA FDC and nutrient IDs, data type, food description, units, food portions and relevant preparation details.
3. Normalize comparable nutrients while carefully distinguishing energy calculation variants, folate DFE versus folate total, vitamin A RAE versus other measures, vitamin E forms, carbohydrate definitions, fiber, added vs total sugars and salt versus sodium. Never combine incompatible nutrient definitions.
4. Deduplicate with deterministic food identity including brand/form/preparation; keep distinct foods if nutritional differences matter; provide reviewed search synonyms and aliases.
5. Detect implausible ranges, unit conversion errors, missing observations, and large regressions versus previous dataset version; quarantine anomalies for review.
6. Stage and review before publishing; publish in a transaction; invalidate dependent recipe caches without retroactively rewriting consumed food logs.
7. Record change log and show the user the food data source, USDA FDC ID, version/date, and observed nutrient coverage; stale records show when last verified.

### 24.3 Calculations and user experience
- Search locally with PostgreSQL full-text/trigram ranking and curated aliases; filtered results disclose raw vs cooked, branded vs generic, and exact serving form; do not let agent invent foods as existing catalog matches.
- Nutrient drawer for each food: 100 g values, user's chosen portion, source hyperlink, basis, data confidence and missing nutrients, with single-tap switch between raw and cooked *only where sourced appropriate records exist*.
- Every quantity adjustment recomputes derived values deterministically, with high-precision internal arithmetic and display-only rounding. Maintain nutrient aggregation state `known`, `partial`, `unknown`, and `estimated`, explaining gaps explicitly; do not treat missing as zero or rounded label zero as measured zero.
- Cooking transformations must prefer official prepared-food records; apply sourced yield and retention factors only if available and clearly label an estimate. Ingredients in recipes are versioned and are not mutated by upstream catalog changes.
- Show users a source inspection screen with upstream identifier, source title, date and URL, and exact values utilized in a recipe. Offer user-reported data errors feeding an admin moderation queue.
- Keep diet reference targets in a *separate* evidence-backed table tied to NIH ODS / National Academies / FDA; never confuse food measurements with recommended intake values.

### 24.4 Acceptance tests
- Import the same USDA release twice: zero duplication, idempotent records and stable hashes.
- Search `spinach`, distinguish raw versus cooked and resolve to actual FDC records with different provenance.
- Enter 50 g vs 100 g of a food: known nutrients scale exactly 0.5x before formatting; unknown nutrient remains unknown.
- Ingredient with incomplete branded micronutrients produces an explicit partial/unknown recipe coverage state, never an apparently complete 100% target bar.
- Changing an imported source value creates a new revision, updates newly edited drafts, and does not alter a historical consumed meal snapshot.
- Switching grams to a volume unit without verified portion conversion refuses to invent a weight.
- Reject negative values, incompatible units, false food names, and wrong nutrient-definition mappings; propagate source citations all the way from catalog to recipe to AI explanation.
- Simulate USDA API downtime: local catalog and user recipe editing continue functioning; the UI clearly shows the last-source-verification time.

### 24.5 Security / reliability
All imports run server-side, in queues, with strict schema validation and provenance checks. Never allow remote food descriptions or research pages to act as instructions to the AI agent. API endpoints must enforce user ownership and rate limits, and admin publish controls require authorization and audit. Back up source snapshots and the normalized DB, monitor completeness and import errors, and include seeded-source fixture tests in CI.

## 25. Cooking-method ontology, education, and nutrition engine — mandatory extension
This section is binding, not optional. The ingredient knowledge base specified in Section 24 MUST explicitly support cooking method, food preparation state, quantities measured before versus after cooking, oil and liquid handling, cooking yield and nutrient retention, source lineage, educational UX, and fully reproducible recipe calculations. Implement supported comparisons without making up precision. If reliable transformation factors are unavailable, label the value unavailable or estimated with an explicit method; never silently use raw nutrients for a cooked food.

### 25.1 User-facing method glossary / taxonomy
Create a versioned, multilingual (English initially, Spanish-ready) `cooking_methods` dictionary with short, friendly plain-language definitions, optional extended guides, illustrations or icon, appropriate food groups, linked official culinary/nutrition references, and aliases. Minimum entries:
- `raw`: uncooked, including when applicable washed/peeled/chopped (track those separately if nutritionally relevant).
- `boiled`: immersed in simmering/boiling water; ask whether cooking water is kept or discarded.
- `steamed`: cooked by steam without immersion; distinguish pressure steaming if evidence supports separate modeling.
- `pan_fried`: shallow fat/oil contact in a pan; ask oil type and added quantity and whether leftovers/drippings are discarded.
- `deep_fried`: submerged in hot oil; distinguish from pan-fried; do not assume all oil used becomes consumed.
- `air_fried`: hot circulating air, optionally added oil; NOT automatically oil-free, and not nutritionally equivalent to deep-fried.
- `baked`: surrounding dry oven heat; record whether added fat/liquid is used.
- `roasted`: dry oven or similar heat promoting browning; track oil and cooking loss.
- `grilled`: heated on a grate/grill, direct or indirect heat; track marinade and discarded drippings.
- `sauteed`: relatively quick cooking with a small quantity of fat in a pan.
- `stir_fried`: fast high-heat cooking while moving food, usually with some oil; count sauces.
- `microwaved`: microwave heating; record liquid and cook-state separately, never promise inherently better retention.
- `braised`: partly submerged, covered, slow cooking in liquid; ask whether liquid is eaten.
- `stewed`: simmered in liquid, often consumed as part of the dish.
- `poached`: gently cooked submerged in liquid below a vigorous boil.
- `pressure_cooked`: cooked under increased pressure, with liquid or steam; track retained broth.
- `slow_cooked`: extended low-temperature cooking; actual technique (wet/dry) is a separate attribute.
- `blanched`: briefly boiled or steamed, usually cooled; specify water discarded.
- `toasted`: exposed to dry heat for browning.
- `reheated`: previously cooked food heated again; track storage state and avoid unsupported double retention transformations.
- `other_unknown`: explicitly unknown, never silently map to a named method.
Definitions are education, NOT blanket claims of nutrient superiority. Provide compact info tooltips plus a learn-more sheet including how it works, typical dishes, taste/texture expectations, possible oil usage, common nutrient considerations, data coverage and source links. Different cooking methods may have the same nutrient estimates when exact composition is unavailable; explicitly say so.

### 25.2 Full cooking state and transformation entity model
Additional normalized tables or equivalent typed entities:
- `cooking_methods`: id/code, label, short_definition, long_definition, aliases, locale, cooking-medium defaults, dietary/allergen notes, educational source IDs, reviewed_at and version.
- `ingredient_preparations`: ID, ingredient source identity and revision, state (raw/cooked/dried/canned/frozen etc.), food cut/form (whole/chopped/peeled), method FK, draining/peeling/soaking/reheating attributes, raw/cooked source record links, safety metadata, source approval status.
- `cooking_parameters`: per recipe-ingredient use, method code, time/temp *optional*, liquid type and quantity, retained/discarded liquid, oil/fat ingredient FK and weighed quantity, raw_ingredient_weight_g, final_cooked_weight_g if known, weight_basis enum (raw/cooked), yield_source_id, cooking equipment optional, notes. Temperature/time can help recipe directions but MUST NOT be presented as scientifically precise nutrient modeling when valid validated coefficients do not support it.
- `cooking_yield_factors`: ingredient or curated food-group mapping, preparation method, raw weight denominator, cooked weight numerator, source ID/version, applicability, confidence/coverage, reviewer, effective date.
- `nutrient_retention_factors`: nutrient ID, applicable food/food class, method and liquid handling, numeric retention factor, source ID/version, applicability, confidence/coverage, reviewer, effective date; do not apply factors outside their intended food/method/nutrient scope.
- `ingredient_preparation_links`: exact USDA cooked-food FDC record ↔ raw source record mappings, review status, comparability warnings; never generate approximate equivalences via text similarity alone.
- `recipe_cooking_steps`: ordered instruction text with method, linked ingredient lines, optional images, temperatures/times, safety references for meat temperatures where shown, provenance and editorial approval.
- `cooking_calculation_snapshots`: recipe revision, input identities and frozen source versions, quantities and weight bases, selected prepared records/factors, oil/liquid assumptions, known/estimated/unknown outputs, transformation traces and algorithm version.
Store cooking methodology and nutritional data sources distinctly. Maintain historical snapshots on logged meals and chef requests.

### 25.3 Deterministic cooking math, no AI-generated nutrient numbers
Preference order for each cooked ingredient:
1. If a suitable official directly measured prepared-food record exists, use that record **with the correct weight basis and preparation equivalence**.
2. Otherwise, only when sourced applicability is verified, use raw ingredient observations combined with method-specific USDA or equivalent reviewed cooking-yield and true-retention factors.
3. If either crucial factor or source is unavailable, mark the affected nutrient unknown or explicitly bounded/estimated as appropriate; allow an additional user-specified actual cooked weight without pretending it supplies missing nutrient-retention evidence.
4. Never apply both cooked-record values and cooking-retention coefficients to the same component, and never double-count oil, sauces, stock, marinades, or salt.
Basic formula (when validated for this food and method): `raw_total_nutrient = raw_nutrient_per_100g * raw_g / 100`; `retained_nutrient_total = raw_total_nutrient * nutrient_retention_factor`; `cooked_weight_g = raw_weight_g * cooking_yield_factor`; `per_100g_cooked = retained_nutrient_total / cooked_weight_g * 100`. The factors must be defined carefully (fractions versus percentages) and allow food-specific mass changes. A cooked-weight input uses the inverse yield mapping only where valid. Log separately calculated total recipe nutrients and per-100g cooked density. For oil, add only oil actually consumed or use a reviewed food-specific absorption model, not all oil poured into the frying vessel; if unknown request a user estimate or present a range/coverage warning. Account for edible portion and liquid discarded versus retained; avoid counting nutrients leached into discarded liquid, and preserve liquid contributions when consumed if supported. Preserve physical plausibility and mass-balance checks.
Examples of correctness: 100g raw chicken cannot be assumed to equal 100g cooked chicken; air frying does not automatically equal zero added fat; 10g of oil used in a pan may not mean 10g consumed; changing raw to boiled spinach must reflect an approved cooked entry or explain that evidence is incomplete; water-soluble vitamin retention is method/food-specific; do not claim nutrient absorption or clinical effects from composition quantities alone.

### 25.4 Required UX in ingredient builder and nutritional comparison
- On ingredient search cards show food name, raw/preparation badge, measurement-basis badge and USDA/source coverage; opening the food shows **Cooking method** selector with familiar labels and one-tap `ⓘ What does this mean?` explanation for each method.
- Display supported method chips only for applicable food; unavailable methods explain whether cooking is not applicable or nutrient data is insufficient. Allow selecting a method with limited evidence if clearly labeled and nutrition confidence conveyed, instead of blocking recipe drafting.
- Ask minimal contextual follow-ups progressively: raw/cooked weighed amount; for frying and sauteing ask oil type and amount with defaults explicitly set to `Not specified`, not zero; for boiling ask broth retained/discarded; for roasting ask whether cooking oil is added; allow 'I don't know'.
- Side-by-side method comparison card: food, same raw starting weight (unless user switches basis), different final cooked yield, kcal/macros/micros with known/estimated/unknown state; a footnote warns that measured 100g cooked food is **not** the same as 100g raw food.
- The calorie/macro/micro bars recompute immediately whenever any ingredient, cooking method, cooking medium, portion, raw/cooked weight basis, or liquid option changes, with the same versioned source snapshot used throughout the daily/weekly planner.
- On each bar provide `How calculated?`, with raw ingredient FDC ID or prepared-food record, factor IDs, yield, oil assumption, uncertainty, calculation date, and clickable citation. Do not infer deficiency from an intake gap, and make weekly smoothing advisory rather than using unsupported day-to-day compensation claims.
- Provide tiny visual method glossary with instructional cards/videos and accessible textual descriptions; source methodological claims to reputable materials and separate kitchen instructions from nutrient-effect claims. Support both beginner and advanced modes: quick preset, expandable preparation details.
- Recipe cards have realistic steps, practical safety guidance and optional generated images clearly marked `AI-generated illustration`, not actual photo of food or proof of nutrition.
- Expose preparation changes as typed AI agent tools (`list_applicable_methods`, `get_method_guide`, `preview_preparation_change`, `compare_preparations`, `set_ingredient_preparation`, `recalculate_recipe`) with preview + approval, structured schema validation, object authorization and audit. Agent cannot assert official source support without evidence returned by tools.

### 25.5 Data ingestion and source registry
Import and retain USDA FoodData Central prepared-food records when relevant; separately ingest USDA Table of Nutrient Retention Factors, Release 6 (2007), and USDA Table of Cooking Yields for Meat and Poultry, Release 2, with versioned provenance, applicable keys, and explicit limits. USDA 2007 release is an actual publication vintage (even when catalog metadata changes), do not mislabel it as recently scientifically updated. For air-frying, prefer trustworthy food-specific prepared records or vetted newer peer-reviewed experimental measurements where their methods and foods apply; do NOT derive universal air-frying retention factors or assert it is always healthier. Edible-portion and recipe guidance may use USDA Food Buying Guide with clear provenance.
Verified implementation references:
- https://fdc.nal.usda.gov/ and https://fdc.nal.usda.gov/api-guide/
- https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/nutrient-retention-factors/
- https://catalog.data.gov/dataset/usda-table-of-nutrient-retention-factors-release-6-2007
- https://agdatacommons.nal.usda.gov/articles/dataset/USDA_Table_of_Cooking_Yields_for_Meat_and_Poultry/24660864
- https://foodbuyingguide.fns.usda.gov/Appendix/DownLoadFBG

### 25.6 Acceptance / regression tests
- For raw versus cooked weights, validate yield conversion and mass/nutrient equations against sourced known examples; ensure no division by zero and legal ranges.
- Verify cooked-food record priority over factor-derived estimation; ensure no double-applying factors.
- Boiled spinach with discarded water versus cooked in soup with broth kept produces separately modeled calculations only if evidence supports the difference; otherwise clearly flag unknown aspects.
- Pan frying with 0g known-consumed oil differs from 10g known-consumed oil by the oil's nutrient contribution; unspecified oil is neither silently treated as 0g nor 10g.
- Air frying supports added oil and does not present fake micronutrient improvements or automatically copy baked/fried numbers.
- `100g raw` and `100g cooked` comparisons label different edible mass/basis; equal raw starting mass comparisons use validated yields.
- Toggle boiled, steamed, baked, fried, air-fried on a supported test vegetable and confirm allowed method selection, method glossary copy, source lineage and dynamic bar update.
- Ensure unsupported method/nutrient combinations show unknown/estimated and never fabricate zero values, precision or links.
- Property tests for portions, edible mass, units, recomputation, missing nutrient propagation, factor boundaries, rounding, repeat cooks, and snapshot consistency after source import updates.
- Agent request 'air-fry my salmon with 1 tsp olive oil instead of deep fry' previews audited tool calls, asks confirmation before saving, and reruns deterministic calculations; its explanation cites the exact returned sources.
- Test method tutorial usability with keyboard/screen reader, mobile touch targets, English glossary, and future Spanish translation hooks.

### 25.7 Implementation priority and completion definition
Include core methods (raw, boiled, steamed, pan-fried, deep-fried, air-fried, baked, roasted, grilled, sauteed) and plain-language guides in initial MVP; extended methods can follow but schema supports all. Before declaring the MVP complete, demonstrate three accurately sourced ingredient preparation comparisons including (1) vegetable boiled vs steamed, (2) protein raw vs grilled/baked using proper mass basis and (3) fried vs air-fried with honest oil assumptions and source-coverage disclosures. If an accurate numerical comparison is unsupported by available data, show that limitation clearly rather than manufacturing a number. Update M1 and M2 acceptance gates, API schemas, seed fixtures, admin interfaces, educational content and E2E journey to exercise these transformations.

## 26. Minimalist Futuristic UX and Three-Transition Interaction Contract (required)

### 26.1 Design north star
The Better Plate must be calm, bright, premium, radically uncluttered, and food-first: inspiration from Apple/Tesla interaction clarity without copying proprietary visual assets or trade dress. Favor natural-white surfaces, restraint, typographic hierarchy, generous spacing, crisp photography, subtle motion, and purposeful feedback. Complexity belongs in underlying systems; nutrition must remain approachable to non-scientists. Every nutritional estimate retains a visible `Estimated` cue and one-tap explanation; significant food-safety/allergen/medical caveats must not be hidden by a minimal aesthetic.

### 26.2 Tokens and styling
Define centralized, theme-ready CSS design tokens with light mode as default: background `#FAFBF9`, surfaces `#FFFFFF`, primary text `#17211E`, accent `#719B87`, restrained gray and semantic warning colors. Use Inter or an appropriately licensed native system typeface (do not bundle Apple SF fonts without licensing). Consistent 8px-based rhythm, comfortable 44x44px minimum touch targets, approx. 14–20px corner radius for major surfaces, subtle elevation, reduced border count, max 1 primary CTA per view, no visual clutter or unnecessary charts. Define color-contrast accessible palettes meeting WCAG 2.2 AA; do not communicate data solely through hue. Support reduced motion, dark system mode as optional later, keyboard/screen readers and localization-ready strings.

### 26.3 Three screen-transition budget
For the ten most important journeys, user should achieve goal in <=3 **screen/tab changes** from an appropriate landing screen; strive for <=2. Inline adjustments, drawers/bottom sheets and state changes do not count as screen transitions but **are still measured for interaction burden and cannot be used to conceal excessive tap sequences**. Tasks that require legally or clinically important consent/confirmation, external OAuth, payments or MFA can exceed the budget; NEVER remove essential safety steps to hit an arbitrary metric. One primary destination per task, back path preserved, no dead ends, no forced multi-step wizards for routine activities.

Required journey contracts (starting from Home unless otherwise specified):
1. Add ingredient and adjust amount: Home -> Meal Builder; autocomplete inline, quantity editable inline, live nutrient deltas.
2. Change cooking method / oil: Home -> Meal Builder; selector / oil quantity inline or single sheet, instructions and estimated nutrition update without navigation.
3. Inspect nutrient source: Home -> Nutrition Summary (if needed) -> Sources sheet; show direct ingredient-level provenance, limitations, methods.
4. Save or duplicate recipe: Home -> Recipe -> save/duplicate in place; immediate feedback and undo.
5. Log a meal: Home -> Meal / Saved Recipe -> mark eaten (planned remains distinct).
6. View week and suggested adjustments: Home -> Nutrition Summary -> Week segmented tab, adjustments inline; show estimated-intake caveat.
7. Read cooking steps: Home -> Meal -> Cook Mode, step progression within Cook Mode, retain screen-on only when authorized/technically supported.
8. Ask AI to modify recipe: Home -> Meal -> Companion sheet, preview diff -> approval; never silently persist AI edits.
9. Contact chef: Home -> Meal -> chef request sheet, submit after explicit confirmation; asynchronous reply visible in messages.
10. Share a meal: Home -> Meal -> Share sheet, private-by-default share card; handoff to system share target/Instagram only where supported and with explicit consent.
11. Search/explore recipe: Home -> Explore -> recipe; filters as inline sheet, no navigation chains.
12. Update dietary preferences: Home -> Profile -> inline preference edits; avoid nonessential onboarding questions.

### 26.4 Information architecture
Mobile primary navigation: `Home`, `Create`, `Explore`, `You`; a contextual `Companion` button/sheet (only connected/available to BYOK users), chef messages accessible from Home / profile and within meal detail. Use up to four bottom destinations, avoid nested top-level tabs; desktop layout may use a slender sidebar with same IA. Default Home includes one hero action (`Create a meal`), today's simple estimated nutrition snapshot, next planned meal and contextual small guidance. Users can enter Create with a blank canvas or from existing recipe. Use one canonical meal-builder view containing ingredients, quantities, cooking options, oil and nutrition preview, with expandable micronutrient detail; keep a persistent save/plan action.

### 26.5 Progressive information hierarchy
Simple default: dish photo, ingredients, basic macro overview, concise insight, `Estimated` disclosure. `Learn` on demand: what nutrients do / practical ways to improve. `Details` on demand: full micronutrient values, reference targets, source IDs, dates, cooking factors, unknown-data indicators and methods. Preferences `Keep it simple`, `Help me learn`, `Show me everything` tune depth, never hide critical safety disclaimers. Avoid diagnosis or food shaming. Use short empathetic plain-language copy, 6th–8th grade readability as aspirational editorial target, not an accuracy shortcut. Ensure users can identify `planned` vs `eaten` at a glance.

### 26.6 Interaction and motion
Use optimistic updates only for reversible low-risk local changes; source-backed nutrient calculations must remain authoritative on confirmed state. Ingredient edits should feel instant (<100ms feedback locally, with recalculation pending state where needed), avoid layout shifts, preserve scroll context and undo for removal. Crossfade/slide transitions ~150–250ms, support `prefers-reduced-motion`. Loading skeletons only where meaningful; show explicit errors, offline/stale-source states, retries and autosave status. No visual-only feedback for screen-reader users.

### 26.7 Core UI components
Implement accessible, tested components: MealCanvas, IngredientSearchSheet, PortionStepper (grams/oz/household measure), MethodPickerWithInfo, OilInput, NutritionSummaryCompact, NutrientDetailsSheet, CitationPopoverAndSourceSheet, CookModeStepper, RecipePreviewDiff, CompanionSheet, ChefRequestSheet, ShareCardPreview, ConfirmationDialog, ToastWithUndo, EmptyState, DataCoverageIndicator, and ResponsiveNavigation. Ensure designed mobile keyboard behavior, accessible focus and labels, touch target bounds, and responsive desktop composition.

### 26.8 Design and usability acceptance tests
- Automated Playwright tests instrument routes and major modal/sheet transitions, checking each required journey against <=3 screen/tab changes excluding external/critical-security flows; also count taps and identify high-friction sheets.
- Mobile viewport tests at 320px/375px/430px, tablet and wide desktop; no horizontal overflow, obscured primary actions, or nutrient information squeezed unreadably.
- Real-user usability script: first-time non-nutrition-expert can create or modify a dish, select steam vs air fry, set oil, interpret an `Estimated` badge, save, and view source explanation without facilitator intervention.
- WCAG 2.2 AA audit (axe + keyboard + manual screen reader pass), legible contrast, large touch targets, reduced motion, focus preservation after modals.
- Screenshot-based visual regressions for Home, Create, Meal Details, Cook Mode, Nutrition Week, Source Details, Companion, and Recipe Sharing; reject crowded or competing primary actions.
- Privacy, allergen and food-safety messages remain accessible regardless of information depth and screen count.
- Use realistic seeded meals and actual source-aware numeric fixtures in acceptance demos; never present illustrative values as verified records.

### 26.9 Execution instruction to coding agent
Before implementing new screens, create wireframes, route maps and task-transition matrix matching §26.3; use shared tokens and components. After each build milestone, evaluate whether extra navigations can be replaced with inline changes and whether the design remains uncluttered. Do not claim compliance based solely on static mockups: run end-to-end task tests and visual/accessibility checks in actual application builds.

## 27. Real Photography and Photorealistic Image Policy (Mandatory)

### 27.1 Visual direction
Use real, properly licensed food photography as first preference for ingredient records, chef-approved recipes, and cooking education. If a suitable real photograph is unavailable, use a high-quality photorealistic generated image, clearly marked `AI-generated illustration` in accessible UI and share exports. No cartoons, illustrated ingredients, mascots, food emoji as photo substitutes, uncanny synthetic food, exaggerated servings, unrealistic textures, garish saturation, or decorative image clutter. Ordinary minimal line icons may be used only for interface controls.

### 27.2 Accuracy and transparency
Recipe-image prompts must derive from an approved, versioned recipe snapshot with actual ingredient list, quantities, method, plating and dietary constraints. Imagery is illustrative, not evidence of nutrient composition, actual cooked appearance, or ingredient/allergen safety. Do not use images to imply certification, endorsements, or chef testing. User photos remain distinct from AI images and licensed catalog photographs. Provide source attribution, copyright/license metadata, consent, alt text and a remove/replace action. Never create a fictitious user meal photo represented as authentic.

### 27.3 Performance and design
Images must use optimized responsive sizes and formats, lazy loading below the fold, intentional crops, consistent natural-light editorial styling and restrained use within whitespace-first layouts. Avoid image generation without user request or explicit admin approval, especially under BYOK cost models; do not silently charge users. Where images are unavailable, use elegant typographic placeholders, not cartoons. Require alt text, adaptive contrast, loading fallbacks and reduced data use. Use one strong hero image in meal detail; avoid image-heavy nutrient dashboards.

### 27.4 Acceptance tests
Automate checks for image type labels, license and provenance, missing-alt detection, image upload permissions, generation consent/cost confirmation, source linkage, and realistic seeded visual regression fixtures. Conduct human visual QA for ingredient fidelity, method fidelity, natural-looking food, brightness, restraint, and absence of cartoon elements.

## 28. Screenshot-First End-to-End QA and Visual Evidence (Mandatory, Release-Blocking)

### 28.1 Principle and coverage
Screenshot-backed end-to-end (E2E) QA is a first-class product requirement, not optional documentation. Every automated critical-user-journey test MUST save a chronological, inspectable visual record of **every meaningful UI state and interaction transition**, including initial screen, each navigation, opened modal/sheet, before-and-after edits, validation feedback, save/publish confirmations, loading/empty/error/retry states, and final result. Capture extra screenshots for scroll positions necessary to see content that otherwise falls outside the viewport. Store screenshots for passing AND failing runs. In addition, record Playwright traces with DOM snapshots/network activity and video of test runs when supported (at minimum video on failure; prefer full recordings in CI when storage allows). A screenshot at each meaningful state does not imply capturing every animation frame; traces/videos provide between-state continuity.

### 28.2 Recommended tooling and setup
Use Playwright Test (TypeScript) for E2E and visual checks, with stable browser contexts, deterministic seeded database, frozen/controlled time where necessary, fixed viewport, consistent fonts, controlled animations, mocked nondeterministic external provider responses, and a separated staging/test environment. Maintain Chromium desktop and mobile-emulated projects at minimum; add WebKit and Firefox smoke suites, and test representative phone widths 320/375/430px plus tablet/desktop. Prefer `data-testid` only where accessible role/label selectors are insufficient; do not make tests depend on CSS class names. Configure reporter outputs as HTML plus JUnit/JSON, screenshots and traces retained as CI artifacts, and bounded videos. Capture screenshots explicitly on every meaningful step, rather than relying on Playwright's `screenshot: 'only-on-failure'` option. Use screenshot assertions for fixed-baseline visual regression; step captures and baseline screenshots serve different purposes.

### 28.3 Explicit step-capture helper
Build a shared `captureStep(page, {journey, step, description, fullPage?})` helper or fixture that captures PNG screenshots and a manifest entry automatically. Manifest fields: test ID, scenario, user role, browser/project, viewport, build SHA, test run ID, deterministic timestamp, ordered step index, step description, route, screenshot relative path, outcome, and relevant sanitized assertion metadata. Use stable, sortable filenames (`journey__001__initial.png`, `journey__002__meal-editor.png`), separate artifacts per test and retry, and index them in a browsable HTML evidence gallery. Attach individual screenshots to Playwright test reports with descriptive step names. Screenshot capture must wait for a clearly defined stable UI condition and suppress animations; don't hide real loading/error states just to stabilize images. Where users see an action that changes the UI, capture before and after that action. Never silently skip captures when tests pass.

### 28.4 Required critical journeys
For every journey below, prove the visual result and save screenshots at each meaningful step:
1. Registration, verification (with test mailbox), sign-in/out, password recovery, account deletion; role boundaries and accessible authentication errors.
2. Onboarding goal/preferences, dietary constraints/allergens, simplified versus advanced nutrient view, privacy choices.
3. Ingredient search, source/provenance panel, missing-value display, portion adjustment, ingredient add/remove; nutrient totals update.
4. Cooking technique education, change method (boil/steam/roast/pan-fry/air-fry), raw versus cooked weight, oil type/amount/spray/residual oil, calculated versus unknown nutrient changes and disclosures.
5. Recipe creation, modification, save, duplicate, undo, delete, recovery from invalid entry and autosave behavior.
6. Cook mode with each step, safety temperature guidance, timers, glossary, estimated timing, offline/connection problems.
7. Daily/weekly nutrition summaries, planned versus consumed, below-target explanations, missing nutrients, source sheets, no medical-diagnosis language.
8. Non-AI complete recipe guidance, including unsupported technique combinations and sensible fallback.
9. OpenAI and Anthropic BYOK connection flow with safely mocked providers, key rotation/removal, spending consent, agent preview, explicit approval/cancel/undo; provider unavailable and no-key fallback. NEVER capture API key values.
10. Recipe image upload/generation consent, generated-image labeling, realistic photo display, broken image fallback, sharing/export preview.
11. Recipe share link, public read-only snapshot, revoke/expiry, SMS and email share-sheet handling, cross-user access denial.
12. Responsive Home/Create/Explore/Profile and core screen-task flows, measuring <=3 screen transitions for designated journeys.
13. Accessibility-driven keyboard interaction, error announcements, focus restoration, mobile keyboard overlay, zoom/large text/reduced motion.
14. Security-sensitive authorization flows, including attempts to view another user's recipes/messages and correct refusal UI.

### 28.5 Visual regression standards
Maintain reviewed baseline screenshots for key screens and overlays in each supported layout and light theme, with approved change workflow. Gate pull requests on meaningful pixel diffs and on semantic DOM/accessibility assertions. Require human approval of intended UI changes; never auto-approve all changed snapshots. Test long text, large values, blank/missing nutrients, translated/localized strings if supported, loading, retry, and offline states. Screenshot diff failures should include baseline, actual and difference image. Report overly cluttered UI, overflow, clipped text, missed CTAs, invisible disclosures, and unreadable nutrient charts as failures.

### 28.6 Privacy and security of QA artifacts
QA screenshots, video, network traces, console logs, and HTML reports can contain sensitive health-related preferences, messages, or account details. Use synthetic seeded accounts and test API credentials only; never real users' meals/messages, production tokens, provider keys, verification codes, payment data, or personal information. Redact or mask secret entry fields and sensitive values **before** capture, ensure traces/network logs sanitize headers, URLs and payloads, and prohibit public artifact hosting. Run on isolated test/staging databases, with least-privilege CI credentials, encrypted private artifact storage, access auditing, expiring artifact retention policy, and deletion controls. Use no real Instagram/public publishing, chef messages, deliveries, or charges in automated E2E; stub endpoints or use designated sandboxes. If a privacy-safe capture cannot be guaranteed, record a redacted placeholder state plus a secure test assertion instead of revealing secrets.

### 28.7 CI execution, report, and evidence handoff
Run fast critical-flow E2E tests on every PR, full cross-browser suites on main/nightly and before releases; require all release-blocking scenarios green. Upload a per-run **QA Evidence Bundle** including: Playwright HTML report, JUnit/JSON result, chronological screenshot gallery and manifest, screenshots for all meaningful steps of passing and failing critical tests, video/trace artifacts per retention policy, visual diffs, accessibility results, navigation-transition metrics, issue list, and environment/build ID. Summarize covered flows, failed or skipped tests, screenshot counts, unresolved blockers, and links to artifacts in the PR/release report. A test that fails to capture required screenshots MUST be reported as incomplete/failing, not silently green. Keep manifests machine-readable and provide a command to reproduce locally.

### 28.8 Release gate and definition of done
Do not label the app 'end-to-end tested,' 'production ready,' or 'deployed successfully' merely because unit tests or mockups pass. A release needs: all critical journeys exercised in an actual browser against an integrated staging environment; complete privacy-safe screenshot evidence for each meaningful state; trace/video diagnostics; reviewed visual baselines; passing functionality/security/accessibility assertions; and documented human review of UX and safety-critical nutrition disclosures. Any waived test must name its owner, rationale, risk, and expiry; critical security, food safety, calculation consistency, and source/disclosure tests may not be silently waived.

---

## 29. Mandatory Modular, Incremental, Screenshot-Gated Development Protocol

### 29.1 Non-negotiable implementation rule
**Do not build the entire application and test only at the end.** Implement one small, user-visible, vertically integrated feature slice at a time. For each slice: design interfaces and contracts; build the smallest working increment; run focused automated tests; run real browser E2E tests; capture privacy-safe screenshots of the initial state and every meaningful transition; inspect and compare those screenshots; run all previously completed regression tests; fix failures; commit the verified increment; and only then proceed to the next slice. A step is not complete merely because code compiles or screenshots exist: assertions must pass and visual artifacts must actually be reviewed.

### 29.2 Architectural boundaries
Organize feature modules with explicit contracts rather than one giant component or service. Suggested boundaries: identity/auth; user preferences and targets; authoritative ingredient catalog and provenance; nutrient calculation; cooking-method knowledge base and cooking guidance; recipe builder; daily/weekly planning and logged intake; explainability and evidence; AI/BYOK tools; realistic recipe imagery; recipe snapshot sharing; social export; admin/review; and shared design system. Keep domain calculations independent of UI frameworks and LLMs. Shared primitives may be reused, but each module owns its tests, schemas, integration contract, fixtures, migrations, UI states, and evidence. Avoid premature microservices: prefer a modular monolith unless demonstrated scale demands otherwise.

### 29.3 Milestone sequence (one runnable vertical slice per increment)
0. **Foundation:** reproducible development environment, CI, database migrations, synthetic fixtures, feature flags, design tokens, Playwright harness, artifact pipeline, report viewer, application shell, error boundaries.
1. **Authentication:** registration, verification, login, logout, recovery, authorization, private route, and deletion request states; capture positive, negative, loading and error screens.
2. **Ingredient catalog:** searchable sourced ingredient detail, units/portions, composition provenance, missing values versus zero; test browser discovery and filters.
3. **Nutrition calculation:** add one ingredient, modify amount, see deterministic and sourced macro/micronutrient estimates update inline; test arithmetic, rounding, precision, and missing data.
4. **Recipe builder:** multiple ingredients, save/reopen/duplicate/edit, persistence, recipe nutrition aggregation and undo; browser tests and navigation counts.
5. **Cooking variations:** raw/boiled/steamed/fried/air-fried/baked/roasted/grilled and other approved modes, plain-language instruction glossary, compatible methods, evidence-aware nutrient calculations, measured oil added/retained versus consumed and no-double-counting checks.
6. **Non-AI cooking guide:** chef-reviewed cooking templates, coherent step sequencing, timers, equipment, food-safety targets and clear estimate disclosures; end-to-end cooking-mode tests.
7. **Meal planning:** daily and weekly planned-versus-eaten states, personal reference targets, estimated intake gaps, incomplete coverage warnings, time-aware suggestions without medical diagnosis.
8. **Transparency/education:** progressive disclosures, simple/learn/detail modes, source drilldowns, accessible language and nutrient explanations; test no overstated certainty.
9. **AI companion/BYOK:** use mocked OpenAI/Anthropic adapters initially; key handling, approved tool contracts, recipe previews, explicit confirmation, undo, navigation, sourced responses, provider-down fallback; never screenshot real keys.
10. **Imagery/social:** real or photorealistic source-controlled imagery, generated-content labeling, recipe sharing and Instagram-supported share flow with safe stubs.
11. **Chef communications:** secure messaging, inquiry/quote/approval flow, admin inbox, authorization and notifications; test no actual orders/charges in CI.
12. **Production hardening:** cross-browser/mobile coverage, accessibility, performance budgets, security tests, observability, backup/restore, deployment rehearsal, rollback, final full regression.
Milestones may be subdivided further. Do not start the next milestone until the current one passes its documented acceptance gate. Prefer minimal working scaffolding over fake or visually complete but nonfunctional screens.

### 29.4 Test pyramid and evidence for EVERY milestone
- **Unit tests:** pure calculation, conversions, quantity changes, cooking retention and oil treatment, all edge cases and missing values.
- **Contract/integration tests:** API schemas, database constraints and migrations, source provenance, permission scopes, external service stubs.
- **Browser E2E:** Playwright against the incrementally integrated app with seeded synthetic data. Capture ordered screenshots before and after each significant interaction, including empty/loading/error/success states, inline changes, overlays, and source disclosures. Include desktop and mobile viewport coverage and test the <=3 screen transition rule.
- **Regression:** after every milestone run (a) tests for the new slice, (b) all prior completed critical E2E journeys, (c) affected contract/unit suites, (d) screenshot visual diff baselines, and (e) accessibility checks. Before release run the full matrix. Failure blocks promotion.
- **Security/safety:** test cross-user access, malicious input, unsafe agent tool use, missing source-data handling, and risky cooking guidance when the relevant capability exists.
- **Visual inspection:** automated screenshots alone are insufficient; inspect for clutter, cropping, tiny text, inconsistent photo quality, misaligned elements, disclosures hidden behind sheets, and misleading nutrition presentation. Reviewers explicitly approve intentional visual baseline changes, with recorded rationale.

### 29.5 Mandatory evidence artifacts, conventions, and manifest
For every milestone create `qa/runs/<build-id>/<milestone-id>/` with `screenshots/`, `videos/`, `traces/`, `visual-diffs/`, `report/`, `manifest.json`, and `summary.md`. Screenshots should use sortable identifiers: `001_<journey>_<state>_<viewport>.png`, etc. Manifest entries include build SHA, milestone, test ID, screenshot path, chronological step, viewport, timestamp, browser, status, assertion summary, and privacy-sanitization status. Every critical test includes screenshot evidence even when passing; preserve video/trace as allowed by secure retention policy. Attach baseline/actual/diff images to visual regressions. Generate a locally browsable HTML gallery linking screenshots to the corresponding test steps. Use synthetic users and redact secrets **before recording**; all evidence remains access-controlled, expiring, and never public.

### 29.6 Definition-of-done checklist per increment
A feature increment is DONE only when:
1. Its user story and measurable acceptance criteria are written.
2. The working full stack behavior is demonstrable without relying on unimplemented screens.
3. New unit/contract/integration tests pass, including negative and boundary cases.
4. New browser journeys run and save all required ordered screenshots, videos/traces as appropriate, and a readable report.
5. A reviewer or designated agent inspects screenshots against the visual specification and records a result; AI review is advisory and does not replace human sign-off for production release.
6. All earlier critical journeys and relevant visual snapshots regressions still pass, or the increment is rejected until fixed.
7. Accessibility, source provenance, nutrition uncertainty, security and safety conditions applicable to the feature are validated.
8. CI publishes a complete QA bundle and a commit/build identifier; missing artifacts count as failures.
9. A checkpoint/commit is made with migration and rollback notes where necessary.
10. The next slice is unblocked only after this gate succeeds.

### 29.7 Workflow enforcement, debugging and failures
Configure CI as stage gates: `lint/typecheck -> unit -> integration -> new-slice-e2e -> prior-critical-regression -> visual-diff -> artifact-completeness -> release-check`. Failing tests, missing screenshots, unexpected visual diffs, or privacy leaks stop the pipeline. Never hide failures with retries or blindly regenerate image baselines. On failure, preserve sanitized trace and before/after screenshot, create a defect with reproducible steps, fix the root cause, rerun the failing test and all affected regressions, then record the resulting passing build. Never change unrelated features merely to make tests pass. Feature flags isolate incomplete increments; unfinished capabilities are not exposed to customers.

### 29.8 Coding-agent execution instruction
Work sequentially through the milestones. At the start of each, announce a concise scope and acceptance tests. Implement only that milestone, run the app and tests, inspect screenshot gallery, fix issues, rerun regressions, and emit a milestone report with files changed, tests run, evidence locations, screenshots reviewed, unresolved risks, and next milestone. Do not declare completion, test success, screenshot capture, review, or deployment without actual execution and verified artifacts. When blocked by external secrets, third-party approval, or absent deployment access, use isolated mocks and clearly record what remains unverified; never assert an externally integrated feature works based on a stub alone. If the agent cannot execute additional milestones in the current run, stop at a verified checkpoint and leave a precise resumable state rather than skipping testing.

## 30. Always-Available In-App Feedback, Bug Reporting, Screenshot Capture, and Privacy-Safe Reproduction (MANDATORY MVP)

### 30.1 Product rule and entry point
Every authenticated customer-facing view, nested recipe/cooking step, modal, and error/empty state must expose a small, visually restrained, keyboard- and touch-accessible **Report an issue / Give feedback** affordance. Prefer a persistent Help/feedback button in the app shell (with equivalent access in full-screen overlays), without obscuring primary CTAs; it must be reachable without navigating away or losing unsaved changes. On mobile respect safe areas and 44×44 px touch targets. Provide a public report path for pre-login registration/login failures, with no assumed user identity. The feature must work even if the AI companion is offline or no API key exists.

### 30.2 Fast, humane reporting interaction
Opening the control launches an in-place sheet/modal (not a new page). Offer **Something isn't working**, **Suggest an improvement**, **Nutrition data concern**, and **Other feedback**. For a bug, automatically offer a draft title, concise human-readable reproduction trail, current screen name, approximate timestamp, app version, platform/browser information, an optional preview of the captured screen, and a short field: 'What went wrong?' Optional 'What did you expect?' and attachment controls. Users can edit or remove any draft text, exclude screenshot/activity details, preview exactly what will be sent, and submit with minimal effort, ideally within one overlay and no more than three actions once opened. Never require the user to reproduce an error or remember a list of steps. Success shows a ticket/reference number, status, and optional follow-up; save an unsent draft during temporary network failures. A crash fallback should let users submit basic text without screenshot or telemetry.

### 30.3 Safe contextual activity trail ('breadcrumbs')
Record a bounded, short-lived ring buffer of *structured, allowlisted UX events* for the active session: navigation, recipe opened, favorite selected, ingredient added/removed/substituted, portion or cooking method changed, form submitted, calculator started/failed, API operation outcome, and surfaced error ID. Include monotonic event sequence, timestamps, route/screen name, object type and privacy-safe identifier, status, and correlation/request ID. Make a **user-readable summary** from structured event names, never by transmitting raw keystrokes or entire browser state. Example: 'Signed in → Opened Recipes → Opened favorite “Salmon & Veggies” → Replaced broccoli with cauliflower → Recipe update failed (ERR-RECIPE-042).' Actual activity must drive this summary; no fabricated events. Detect unexpected exceptions and failed API requests to open the feedback sheet with relevant context, but do not force reporting. The event buffer must be bounded (e.g. last 20–30 relevant events or 10 minutes), have a retention policy, and be erasable. Do not collect password entry, free-text messages, typed health information, payment details, access tokens, API keys, third-party cookies, private nutrition goals, or hidden browser tabs. Use data minimization: user account reference server-side (if signed in), not raw credentials. Mask sensitive recipe/profile details according to privacy settings; allow user editing/redaction of the readable summary. Do not make session replay or broad continuous screen recording the default.

### 30.4 Screenshot capture with consent and fallbacks
Provide 'Attach screenshot of this screen' with a **clear preview before submission** and a simple remove button. For web/PWA, use an in-app DOM renderer when feasible; it is not guaranteed to capture cross-origin images, canvas, video, browser chrome, or certain protected elements. Provide an equally easy native screenshot upload fallback; avoid claiming full-device capture capability without an explicit OS-supported permission flow. Prior to capture, automatically exclude/mask password controls, API keys, billing fields, personal messages, tokens, emails where unnecessary, health/sensitive profiles, and third-party embeds. Scrub screen data *before capture* where possible, verify masking in tests, and let the reporter crop/redact/replace the image. Never capture other tabs, notifications, or the whole screen silently. User opt-in is mandatory for the screenshot; no screenshot is transmitted until the final Submit action. Encrypt stored screenshot attachments, issue short-lived signed access URLs, and enforce size/type limits and malware/content checks. Show a privacy line: 'You choose what to send. Review your screenshot and activity summary before submitting.'

### 30.5 Diagnostic envelope and secure transport
Bug report schema includes reportId, category, severity/user-selected impact, subject, description, expectedOutcome(optional), sanitized breadcrumbs array, screenshotAttachmentIds(optional), currentRoute, client build/version, supported browser/OS/device viewport metadata, errorCode, server request correlation IDs, createdAt, authenticated reporterId if available, and consented diagnostic flags. Server-side validation, size limits, rate limiting, abuse controls, attachment scanning, least-privilege access, and CSRF/auth protection apply. Never store secrets or private raw request/response bodies. Capture JS stack traces or network diagnostics only after server-side redaction and with a documented privacy policy. Include handling for minors and household profiles; no sensitive information should leak to public issue trackers or email notifications.

### 30.6 Admin triage and communication
Create an admin-only Issue Inbox with search, filters (new/acknowledged/in progress/needs info/resolved/closed; category, module, version, severity), screenshots, concise replayable breadcrumb timelines, correlation IDs, deduplication by error signature, assignment, internal notes, and customer responses. Admin should be able to request more context via secure in-app messaging without exposing developer diagnostics. Notify admins of severe/new issues through configurable channels with no sensitive payload in notifications. Give reporters a 'My feedback' history with status and replies (where appropriate), and a one-tap update path. Nutrition-data complaints should include the specific referenced food, nutrient, source/version, and clearly labeled dispute flow for scientific review.

### 30.7 Observability, analytics, and lifecycle
Connect consent-appropriate client/server error monitoring using pseudonymous identifiers and trace correlation, sanitized logs and environment-specific retention. Define severity levels and owner, response expectations, duplicate suppression, and trend analytics (reports per active user, recurring broken flows, time to resolution). Aggregate usage metrics must not leak individual diet/health information. Privacy policy must disclose what is collected, purposes, retention, and how users can request deletion; apply reasonable deletion windows and automatic artifact expiry.

### 30.8 Required QA and screenshot-first end-to-end tests
Build this capability as an early modular slice, immediately after the app shell and sign-in foundations, and make the report button part of the shared shell component to cover future screens by construction. For every subsequent feature increment, regress that the report affordance remains reachable and unobstructed. Playwright tests must save numbered screenshots and traces of: desktop/mobile button visibility, opening the feedback sheet from recipe/edit/cooking flow and error states, report prepopulation reflecting an *actual* simulated sequence (login → favorites → salmon/veggies → broccoli-to-cauliflower swap → injected save failure), editable/removable breadcrumbs, consented screenshot capture and preview, screenshot exclusion/redaction of planted fake sensitive inputs and API keys, submit success with report ID, offline retry, anonymous login-page reporting, administration triage/status update, and failure fallback. Verify no screenshots or raw sensitive diagnostics are uploaded before consent. Test keyboard and screen-reader access, rate limits, RBAC (users cannot see another user's reports), payload abuse, and safe deletion. CI requires visual evidence for these journeys; missing screenshots or privacy leaks block progression/release. Avoid using real personal data in QA artifacts.

### 30.9 Acceptance criteria
- An issue can be submitted from every app screen without navigating away and without destroying unsaved recipe work.
- A real, relevant, redacted action trail is prefilled automatically, editable and omittable by the user.
- Screenshot is optional, explicitly previewed, and never transmitted without consent.
- Critical exception states still allow reporting even if the normal app workflow fails.
- Reporting works without an AI API key; users receive a report reference and can view its status.
- Admin receives actionable reports with correct access controls and bounded, privacy-safe evidence.
- Screenshot-first E2E test artifacts and regression checks are present in every milestone after this feature ships.

## 31. Production Readiness, Operational Architecture, and Missing-Capability Gap Closure (MANDATORY)

### 31.1 Engineering principle
Treat product capabilities and production engineering as separate acceptance dimensions. A feature is not ready if it works only on a developer laptop. Preserve modular vertical-slice delivery and screenshot-gated regressions from Sections 28–30. Every requirement below must be traced to a module owner, automated or human verification, production monitor (where appropriate), and release gate. Do not call unimplemented platform behavior complete.

### 31.2 Domain boundaries, API contracts, and data ownership (MVP)
Define bounded modules for identity/profile, ingredient catalog and provenance, nutrition reference targets, recipes and cooking, meal plan and logging, AI agent, images/media, share-link snapshots, feedback, notification, and admin. Prefer a modular monolith initially rather than prematurely distributing services. Each module owns its schema/interfaces and exposes versioned typed contracts with OpenAPI and generated validation. Keep nutrient arithmetic and food-safety rules in deterministic server-side/domain libraries; do not duplicate numerical logic in UI and LLM prompts. Represent units using typed quantities (mass, volume, servings, temperature) and validate conversion assumptions. Use stable IDs, source revision IDs, recipe revisions and immutable nutritional calculation snapshots. Repository includes architecture decision records, interface contracts, dependency diagram, and clear ownership.

### 31.3 Offline-first drafts, network recovery, and PWA lifecycle (MVP)
Provide resilient draft persistence for recipe editing, cooking steps, and unsent feedback using IndexedDB with bounded encrypted-at-rest where realistically available and never place API credentials or sensitive health records into unsafe persistent browser storage. Explain limits of browser storage security. Queue permitted offline edits with unique operation IDs and visible 'Saved on this device / Syncing / Synced / Needs attention' states. Resolve conflicting recipe edits with versions/ETags; never silently overwrite newer server changes. Offer review-and-merge or copy-draft when automated merge is unsafe. Avoid offline writes to paid orders or chef communications that imply completion; label queued actions as not sent. Test offline start, network flapping, quota exhaustion, storage eviction, interrupted sync, stale client upgrades, and concurrent edits on two devices. Precache minimal safe app shell and cooking content as appropriate; never cache authenticated API responses publicly. Service-worker upgrades must be non-disruptive, support a kill switch, and include backward-compatible migration tests. PWA features vary across mobile platforms; verify on actual iOS and Android.

### 31.4 Data migrations, numerical reproducibility, and import pipeline (MVP)
Use transactional schema migrations, staging rehearsal, backward-compatible expand/migrate/contract deploy pattern, and explicit restore plans when reversing a migration is unsafe. Back up and test restore before destructive schema work. USDA ingestion has source snapshots, checksum, revision, import date, license attribution, bounded rate limiting, 429 backoff, deduplication, quarantine of malformed records, completeness reports, and rollback to previously verified catalog. Current public USDA API default: 1,000 requests/hour/IP, subject to change; prefer licensed official dataset bulk ingestion for initial large imports. Treat branded nutrient null and missing distinctly from measured zero. Use food-form/yield/method versioned records. Rerunning calculations with identical source versions and inputs must produce identical results. Historical logged meals should retain original calculation snapshots, with deliberate opt-in recalculation clearly marked. Add property-based tests for mass conservation where applicable, unit equivalence, nonnegative edible nutrient values, missing coverage and zero-oil scenarios, and boundary rounding.

### 31.5 Asynchronous jobs and external dependency resilience (MVP for selected features)
Run USDA sync, AI image generation, email, notifications, image processing and periodic reference updates as asynchronous durable jobs (queue + worker). Require idempotency keys, deduplication, exponential backoff with jitter, bounded retries, dead-letter queue, auditability and replay controls. Track pending/succeeded/failed states in user-friendly language. Enforce provider timeouts, concurrency quotas, retry budgets and circuit breakers; upstream outages must not break local meal editing. Provide job recovery after deploy and scale-down. Explicitly separate safe automatic retries from billable or irreversible operations.

### 31.6 Privacy, regulatory scope and legal review gate (MVP; before connected health data)
Minimize stored diet/health data and ensure users understand optional data collection, retention and deletion. Do not assume lack of HIPAA coverage means lack of obligations. Before launch, obtain qualified review of FTC privacy obligations and applicability of the FTC Health Breach Notification Rule, state privacy laws, consumer marketing claims, children's use, accessibility, app platform rules, and eventual chef fulfillment/food licensing. In particular, connecting user-entered nutrition data with wearables or other external sources can create additional FTC requirements. Do not silently feed personal nutrition logs to analytics, replay, advertising, external LLMs or third-party imagery services. Obtain explicit, scoped consent where needed, display precisely which information a BYOK provider receives, and support account export, deletion, retention schedules and audit of vendor processors. Disclosures do not replace compliance or accurate claims. Make minimum supported age and household/child account policy explicit before activation.

### 31.7 AI-agent boundaries and secret governance (MVP AI phase)
Use explicit allowlisted typed tools with server-side authorization on every invocation, per-user ownership checks, bounded scopes and confirmation for persistent mutations, chef communication, uploads, social shares, orders and purchases. Never allow the agent to execute arbitrary code/SQL, browse internal admin routes, fetch arbitrary internal URLs, or use user-supplied URLs as unrestricted server-side fetch targets. Treat recipe text, linked pages, research PDFs, imported ingredients and tool outputs as untrusted prompt-injection surfaces. Separate conversation content from executable permissions. Encrypt provider API keys with envelope encryption and managed key rotation, never send keys to browsers after submission or log them, avoid embedding secrets in telemetry/screenshot/replays, and provide disable/rotate/delete flows. Add per-user provider spending caps and clear cost attribution; be honest if hard cost limits cannot be guaranteed due to asynchronous billing. Simulate malicious prompt injection, attempted cross-account reads, attempts to suppress disclaimers, and attempts to forge nutrient values in tests.

### 31.8 Supply chain, security engineering and disaster recovery (MVP)
Target a threat model plus OWASP ASVS-aligned control verification; enable dependency vulnerability scanning, secret scanning, lockfiles, signed CI artifacts/provenance as supported, least-privilege CI roles, infrastructure-as-code changes with review, short-lived credentials, server-side authorization tests, rate limiting, anti-automation for auth, audit logs for administrative changes, and staged secret rotation drills. Encrypt DB backups and restrict restore access. Set explicit RPO and RTO targets after business-owner approval; test restore from backup periodically. Document incident ownership, incident response and breach notification workflows; run tabletop exercises. Ensure privacy-safe incident diagnostics. For an MVP choose modest achievable uptime objectives; do not promise 24/7 support without staffing.

### 31.9 Observable production, alerting and user feedback (MVP)
Instrument typed structured events, request/trace correlation IDs, client-side errors, server errors, background-job status, DB query latency, nutrition-calculation errors, data coverage and freshness, route latency, image errors, and chef message delivery status. Do not log raw meal content, private messages or API tokens. Define service-level indicators for key flows (successful login, recipe save, nutrient recompute, report issue, chef request), alert thresholds and runbooks. Track release health and error rate by app version. Use privacy-first replay or event breadcrumbs connected to user reports, with default masking and review. A DOM-reconstructed session replay is not equivalent to an actual screenshot, so collect consented real screenshot attachments where appropriate. Set bounded retention/deletion rules and avoid indiscriminate session recording.

### 31.10 Performance, accessibility, internationalization and devices (MVP)
Set user-facing budgets: p75 Largest Contentful Paint <=2.5s, Interaction to Next Paint <=200ms, Cumulative Layout Shift <=0.1, measured separately on mobile/desktop and representative constrained devices, using real-user telemetry and lab tests. Require keyboard navigation, visible focus, screen reader labels and announcements, sufficient contrast, zoom support, reduced motion, error recovery, and WCAG 2.2 AA targeted audit by an actual reviewer. Three-screen-transition target is evaluated per critical user journey and never prioritized above accessibility or safety. Support locale-aware units (g/oz, C/F), decimal separators, timezone-aware daily logging, and initial English locale design with a localization-ready architecture, allowing Spanish expansion. Never translate nutrient quantities through an LLM as the arithmetic source. Verify common slow/mobile networks and responsive layouts without cartoon assets.

### 31.11 Monetization, fulfillment, and social integration contracts (when activated)
For subscriptions/payments: hosted PCI-appropriate checkout, webhook signature verification, idempotent webhook consumers, reconciliation against payment provider state, cancellation/refund/retry states, tax/receipt policy and subscription entitlement tests. For private-chef orders: availability, location coverage, kosher/allergen cross-contact policy, delivery estimates clearly labeled, substitutions approval, food-handling/labeling requirements, order-status audit history and human approval workflow. For Instagram: define supported share-sheet/deep-link flow by mobile platform, differentiate it from automatic publishing, verify Meta account permissions and API requirements before enabling publishing, provide graceful fallback with share image + caption copy; do not promise direct posting from all account types.

### 31.12 Media and source rights (MVP)
License/attribute photographs, cooking videos and educational articles appropriately; store asset ownership, image origin, permission, generated/photographed disclosure, usage rights, source citation and takedown status. AI recipe illustrations must be labeled, not represented as tested finished meals. Transform external references into original short educational copy with vetted citations; no verbatim copying of copyrighted recipes/articles/video unless licensed or otherwise permitted. Reject unlicensed stock, embedded watermarks, or misleading AI visuals.

### 31.13 Analytics without surveillance (MVP)
Use privacy-preserving aggregate product funnels: signup completed, first meal built, first meal saved, weekly planner revisited, recipe shared, feedback sent. Avoid individual diet/health content in third-party analytics. Respect consent, opt-out and account deletion. Add feature flags and A/B testing only after baseline usage and privacy safeguards exist. Establish a measurable adoption and quality dashboard with denominator definitions and alert sensitivity. Do not optimize engagement by shame, calorie anxiety or excessive notifications.

### 31.14 Production release pipeline, rollback, and operational readiness (MVP)
Environments: local, CI ephemeral, staging, production with isolated databases and credentials. Deploy using reviewed infrastructure-as-code and reproducible lockfile builds. CI gates: lint/typecheck, unit, contract, integration, security scan, nutrition golden dataset, selected E2E on multiple viewport sizes, screenshots at each meaningful transition, visual diff review, accessibility checks, prior-module regression, backup/migration checks, staging smoke, then controlled production rollout. Feature flags prevent unfinished features from appearing. After deployment, production smoke tests use synthetic accounts only and avoid actual purchases or sending client messages. Implement canary/gradual rollout where feasible, abort thresholds, rollback for code and safe data plan, and release notes. Archive a sanitized QA bundle with screenshots, traces, environment, version, timestamps, and reviewer decision. No next module proceeds while critical gate fails.

### 31.15 Concrete gap-audit acceptance checklist
- [ ] Offline recipe draft remains intact across network loss and app restart; conflicts are surfaced and resolved.
- [ ] Two-device edit conflict cannot silently erase recipe ingredients.
- [ ] USDA outage or 429 response preserves verified local ingredient search and existing nutrient calculations.
- [ ] Source revision update cannot unexpectedly alter historical log without explicit revision policy.
- [ ] Queue retries cannot create duplicate AI image charges, duplicated outbound share notifications when idempotency is available.
- [ ] Backup restore and schema migration are demonstrated on staging and documented.
- [ ] Deleting an account removes or deidentifies user-specific data according to published policy, including report/media retention exceptions.
- [ ] Cross-account data attempts and tool-injection attempts fail securely.
- [ ] User can finish core recipe flow without AI, Instagram, payment service or image provider.
- [ ] 3-transition navigation, WCAG target, real-device operation and performance budgets have visible recorded evidence.
- [ ] Feedback reports preserve privacy, attach only consented screenshot and accurate action breadcrumbs.
- [ ] A full release includes screenshot gallery, failures, fixed issues, regressions, version trace, and rollback instructions.
- [ ] Owner has reviewed regulatory applicability, vendor contracts and food-business requirements before activating related features.

### 31.16 Suggested development placement
Integrate requirements into existing modular milestones rather than creating one enormous final phase: **Foundation:** architecture/contracts, privacy threat model, flags/observability, performance and accessibility baseline, screenshot QA; **Authentication:** data access, identity recovery, privacy controls; **Ingredient:** data import revisioning, source coverage, rate limits; **Recipe:** offline drafts/concurrent edits and nutritional reproducibility; **Cooking:** food-safety test fixtures and versioned cooking transformations; **Planning:** timezone and cross-device conflict behavior; **AI:** allowlisted agent tools, cost controls, provider secrecy, injection tests; **Media:** rights and safety disclosures; **Chef:** asynchronous messaging and regulated fulfillment gating; **Prelaunch:** restore drill, legal review, staging-to-production smoke tests, rollback rehearsal, full device matrix. Each slice must finish with evidence before continuing.

### 31.17 Research reference links (verify current versions during implementation)
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Web.dev Core Web Vitals: https://web.dev/articles/vitals
- FTC health apps and breach notification rule: https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Sentry session replay privacy: https://sentry.io/product/session-replay/
- General PWA production checklist: https://progressivewebapps.com/guides/production-checklist/

## 32. Product Positioning, User Responsibility, Privacy Rights, and Legal Disclosure Gates (MANDATORY)

### 32.1 Identity and scope
The Better Plate is a general-purpose food discovery, recipe customization, cooking education, and nutrition-estimation software tool. The operator does not claim to be a registered dietitian, licensed nutritionist, medical professional, or provider of individualized medical nutrition therapy. Do not market or operate as diagnosing, treating, curing, preventing, or managing disease. Any future credentialed-professional offerings require separately scoped services, qualifications, and legal review. Feature behavior and marketing must match these representations; boilerplate cannot override actual product functions.

### 32.2 Simple, layered, conspicuous user-facing disclosures
Provide a brief, friendly core disclosure at onboarding and at appropriate decision points, with linked plain-language fuller explanation and legally reviewed terms. Proposed short form: "The Better Plate helps you explore recipes and understand estimated nutrition. We aren't dietitians or medical professionals. This is educational information, not personalized medical or professional nutrition advice. You choose what to cook and eat. Actual nutrients and cooking outcomes vary. Ask a qualified professional about your individual health needs." Never assume a checkbox alone makes disclosures effective. Preserve accessible, readable notices.

### 32.3 Nutritional uncertainty and freedom of choice
All nutritional values and suggested dietary-target comparisons are estimates derived from reference sources and user entries, not measurement of the actual food or proof of bodily status. Avoid disease or deficiency diagnoses, prescriptive medical recommendations, false precision, guaranteed outcomes, guilt-based UI, or positioning scores as authoritative. Record evidence source/version and limitations; make them inspectable in one or two taps. Use practical safety warnings even when they complicate marketing simplicity.

### 32.4 Appropriate allocation of responsibility
Explain that users decide whether to prepare, consume, purchase, or share recipes and should verify allergens, ingredient identity, suitability, and safe handling. Implement reasonable product safeguards and do not assert that users assume absolutely all risk or that the company has no legal obligations. Terms may contain counsel-reviewed limitations of liability, permitted warranty disclaimers, and dispute clauses only as allowed by applicable law; do not waive non-waivable consumer rights, statutory duties, gross negligence, intentional misconduct, or claims that legally cannot be excluded. Never treat terms as a substitute for safety, quality, security, or incident response.

### 32.5 Data processing rights: broad product improvement, not unrestricted exploitation
Require a comprehensive data inventory and purposes register. Separate: (a) data needed to provide the product (profiles, recipes, saved preferences, support and debugging); (b) security, service operations and analytics; (c) optional research/product development and training; (d) optional marketing, advertising, sale/sharing, or provision to third-party AI providers. Give clear notice, appropriate user choices and affirmative consent where law or context requires, especially for sensitive health-related entries. Do NOT use a blanket term saying "we may use all your data for anything, now or in the future." Materially new purposes, new third-party recipients, or retrospective new uses may require new notice/affirmative consent, applicable opt-out controls, or a prohibition. Do not silently route identifiable health data to third-party analytics, ad pixels, AI training, or external AI keys. BYOK AI input must be specifically disclosed with a preview/allowlist of transmitted context. Technical enforcement via policy checks must match choices. Support data access, export, deletion, consent revocation as applicable, and role-bound retention limits.

### 32.6 Aggregated and deidentified analytics
The operator can plan for evolving product improvement using legitimately aggregated/deidentified data, subject to law, contracts, commitments against reidentification, rigorous separation from identifiable data, and reasonable safeguards. Deidentification must be substantive, not merely deleting a name; dietary/activity histories may be reidentifiable. Do not promise unrestricted future use or retroactively repurpose user data. Log datasets' lawful basis, extraction, retention, distribution, and approved uses.

### 32.7 Legal/regulatory verification gates
Prior to launch, have qualified counsel review Terms of Service, Privacy Policy, cookie/analytics disclosures, consent UX, children's age eligibility, health-app classification, FTC Act and Health Breach Notification Rule applicability, applicable state privacy/consumer laws, vendor terms, cross-border processing if offered, and insurance/liability exposure. HIPAA's nonapplicability, when true, does not remove FTC or state obligations. FTC HBNR may apply to some apps capable of combining consumer-supplied health information with tracker data. Avoid unreviewed promises about legal classification or enforceability.

### 32.8 Product and QA requirements
- Test onboarding and relevant decision screens for clearly visible concise disclosures and a plain-language full policy.
- Verify no medical/professional credential claim in marketing, AI answer templates or recipe suggestions.
- Test a full consent matrix: optional analytics off, optional AI data sharing off, account deletion/export, consent change, and third-party provider failures.
- Validate audit logs and policy enforcement for each background processing purpose; no unstated health-data use.
- Test AI recommendations against red-flag cases for diagnosis claims, nutrient deficiency labels, allergens, harmful restriction, and unwarranted certainty.
- Verify screen-reader accessibility, mobile readability, and screenshot evidence for each privacy and disclaimer journey.
- Block release of data use, data-sharing, payments, fitness integrations, or credentialed nutrition offerings until the corresponding legal and security review gates are signed off.

### 32.9 Reference materials for legal review
- FTC mobile health app best practices: https://www.ftc.gov/business-guidance/resources/mobile-health-app-developers-ftc-best-practices
- FTC collecting/using/sharing consumer health information: https://www.ftc.gov/business-guidance/resources/collecting-using-or-sharing-consumer-health-information-look-hipaa-ftc-act-health-breach
- FTC mobile health apps interactive tool: https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool
- FTC Health Breach Notification Rule: https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0

IMPORTANT: This section is a product and implementation requirement, not legal advice or final binding consumer contracts. Obtain jurisdiction-specific legal review before release.


## 33. FREE PUBLIC LAUNCH PRIVACY-MINIMIZED SCOPE — PUBLIC-EXPOSURE RULES (MANDATORY)

### 33.1 Launch model and binding exclusions
The Better Plate launches **100% free**: no pricing page, premium tier, subscription, paywall, in-app checkout, quote collection, order placement, delivery management, customer-to-chef inbox, chef fulfillment dashboard, or integrated billing is accessible **to public users at launch**. Chef cooking, commercial communication, pricing, logistics and payments are initially performed separately outside the app. **Build chef operations as an isolated, feature-flagged module and test them in private staging, but keep them disabled and inaccessible in the public production experience until explicit legal, privacy, food-safety, and operational approval.** Section 34 controls future release of these capabilities. Do not remove their modular architecture or tests merely because they are unreleased.

### 33.2 Strict personally identifying account fields
Collect and persist only **email address** (required for sign-in) and **display name** (optional) as user-facing identity/profile fields, plus minimum technical account IDs, authentication/session metadata and security logs needed to operate securely. **Do not request or store phone number, residential/delivery address, legal name, birthdate, height, weight, diagnoses, health records, lab results, pregnancy information, payment information or fitness/wearable data.** Do not require demographic profiling. Avoid covert collection of extra identifying fields through analytics, crash tools or AI prompts. Technical connection metadata such as IP may be processed by necessary infrastructure; disclose, minimize and retain according to policy rather than falsely asserting that absolutely no other personal data is processed.

### 33.3 Food-planning records
Store explicitly user-chosen **planned meals** and separately user-confirmed **consumed meals**, each with time/date, time zone, recipe/version reference, portions, sourced ingredient mapping, cooking choices, estimated macro/micronutrient calculation snapshot, and provenance. Saved recipes and favorites are permitted as necessary for these capabilities; do not infer actual consumption from a plan or favorite. Allow correction and deletion; don't infer or store diagnoses or individualized medical conclusions. Nutrition bars may compare entries against general dietary reference values with clear suitability/uncertainty disclosures, not medical assessments. No hidden health profiles.

### 33.4 Educational content guardrails
All statements are **general food and cooking education**, grounded in named authoritative sources. Do not diagnose deficiency, recommend treatment, imply professional nutrition advice, prescribe an individual meal plan for a medical condition, guarantee outcomes, or claim that an estimated log establishes health status. Rule-based, user-controlled recipe suggestions and optional BYOK AI may discuss nutrients and general culinary alternatives; distinguish objective sourced food values, computed estimates and editorial education. Where the earlier specification references personalization by weight, age, sex, medical status, conditions, or professional diets, those capabilities are disabled for this launch.

### 33.5 Revocable recipe link sharing
User action **Create share link** generates a random unguessable UUIDv4 or stronger token associated with an immutable, sanitized read-only recipe snapshot. Show a review screen before creating it. Share only selected dish name, ingredients/portions, cooking method, instructions and optional estimated nutritional data; **never attach user email, display name, planned/consumed history, private preferences, account identifiers, messages or AI keys**. Implement copy link and OS-native sharing, with SMS/email deep links or fallback, but do not request phone/address access or send messages from the server. The public view must not expose private internal IDs; link is revocable, can have optional expiry, uses no-index headers and basic abuse-rate limits. Shared link can be accessed by anyone possessing it; warn user. Users arrange all chef matters externally.

### 33.6 Privacy, security and regulatory gates
Even free educational food apps can be subject to FTC Act, state privacy/security rules and potentially the FTC Health Breach Notification Rule; storing identifiable consumed-meal history calls for a counsel-led classification review before launch. Limit collection, protect identifiable recipe/intake logs, implement account export/deletion and a clear purpose-specific privacy notice. Never assert the free model exempts the product from laws. BYOK is optional; tell users what recipe/context is sent to their chosen AI provider before an API call, and never send their full history by default. User event diagnostics/screenshot reports are opt-in at submission, reviewable/redactable, and must never leak identity or dietary history to unauthorized persons. Any new data type or health integration requires a new privacy/design/legal gate.

### 33.7 Acceptance gates and modular build sequence
- Registration form only asks for email and optional display name; privacy and source disclosures remain available. Password/passkey/MFA secrets are authentication mechanisms, not extra profile fields.
- No phone/address inputs, API fields, DB columns, analytics events or invitations for such information in the launch experience.
- Plan and consumed logs operate independently and their estimated nutrition totals remain reproducible from versioned food data.
- Save, edit, undo, log, unlog and delete each meal type; test cross-user authorization denial.
- Recipe snapshot generates a distinct random share token, opens anonymously read-only, and remains unchanged if original is edited; revocation causes public link to stop working.
- SMS/email handoff sends only user-reviewed URL/content through device apps, never through in-app chef messaging.
- No cart, subscription, checkout, quote or fulfillment functionality is accessible to public customers at launch. Unreleased commerce and chef modules have their own private integration/security tests and release gates, and may be deployed inert or kept out of production until approved.
- Educational statements and AI outputs pass evidence, uncertainty, and no-diagnosis checks.
- Every journey receives Playwright screenshots, trace artifacts and regression evidence; tests verify no accidental extra data collection.
- After each vertical slice, run screenshot QA plus the full cumulative regression suite before proceeding, per Sections 28–29.


## 34. FEATURE-FLAGGED EXPANSION, PRIVATE CHEF MODULE, AND CONTROLLED RELEASE GOVERNANCE (MANDATORY; OVERRIDES CONFLICTS)

### 34.1 Build-complete is not release-enabled
Develop a comprehensive, modular product over successive tested vertical slices, while launching the public app as free cooking education, recipe building, meal planning/logging, optional BYOK AI, and revocable read-only recipe sharing. A feature may be coded and validated in isolated staging without being enabled for public users. **No feature is permitted to skip its own screenshot-first end-to-end testing, cumulative regression tests, security review, or explicit release approval.** Keep earlier Section 33 account-data minimization as the binding rule for the public release.

### 34.2 Feature-flag platform
Implement a server-controlled feature registry (e.g. `feature_flags`, `flag_audit_log`, `feature_release_approvals`) with key, description, owner, environment, state, rollout percentage or allowlist, dependencies, creation/change timestamps, configuration version, and default OFF. Start with:
- `chef_inquiries`: OFF
- `chef_messaging`: OFF
- `chef_quotations`: OFF
- `chef_orders`: OFF
- `chef_checkout`: OFF
- `chef_delivery`: OFF
- `chef_admin_operations`: OFF except tightly restricted private staging or approved internal access
- `paid_subscriptions`: OFF; not required for public MVP

The admin dashboard can **request, stage, preview and manage flags**, but sensitive features require recorded release approvals. Changes must be audited (actor, time, reason, previous/new state), require strong admin authorization/MFA, and propagate predictably. The public frontend may read sanitized effective flag values, never internal secrets or unreleased configuration.

### 34.3 Defense in depth
Do **not** rely on hiding navigation links. Unreleased features are OFF by default on both client and server. Every protected API route, action, background job, webhook, and persistence workflow enforces the flag server-side **in addition to normal authorization checks**. Direct URL access, manipulated requests, stale client caches, and forged flag state must all fail closed. No unaudited flag enablement from a database console or arbitrary user setting. Minimize production attack surface by not deploying optional unfinished services or routes when unnecessary. Separate development, staging, and production with distinct credentials, databases, and external-service accounts.

### 34.4 Chef operations, built privately
Maintain isolated domain modules for customer inquiries, secure chef messaging, quotations, recipe snapshot attachment, scheduling, orders, payment integration, fulfillment, delivery, cancellations and refunds, staff/admin permissions, and notifications. Design interfaces and migrations in modules and incrementally complete, test, and screenshot them in staging. Use mock payment and notification providers in test environments. No real charges, real delivery requests, or external customer notifications during private testing. Chef modules cannot automatically inherit public user dietary history, email contact permission, or uncollected phone/address information.

### 34.5 Personal-data collection only after a release gate
At launch, collect **email, optional display name, planned and consumed meal records**, plus minimum necessary security/operational metadata, with no phone, address, payment details or other previously excluded profile data. Enabling chef orders or delivery may require additional information; **the mere existence of a disabled feature is not permission to collect it**. Before enabling such a feature, conduct a field-by-field data-minimization review, amend privacy notices and contracts, obtain required user consent, enforce purpose limitation, set retention/deletion rules, and provide data isolation from the free educational experience. Collect optional future data only from users who intentionally use that new feature, at the point of need.

### 34.6 Two-step controlled release, with kill switch
For regulated/high-impact functionality, enabling a switch in the dashboard does not bypass release readiness. Require: (1) signed-off readiness checklist by a designated authorized approver (legal/privacy, food-safety/licensing, security, payment, accessibility, customer support as applicable); (2) a separate authorized admin activation with audit log and (if necessary) reauthentication. Support internal allowlist -> small opt-in pilot -> gradual percentage rollout -> full release, with flags pinned OFF by default for new accounts. Implement an immediate server-side emergency disable (kill switch) that stops new transactions/actions safely without corrupting already accepted orders; preserve appropriate status communications and reconciliation on disable. A rollback must not silently discard charged transactions or obligations.

### 34.7 UX / free product integrity
Keep the 4-destination minimalist navigation and <=3-transition user journey target. Do not show teaser screens, upsells, paid pricing, carts, disabled navigation tabs, chef notifications or unreleased capabilities to the public. Recipe sharing by revocable UUID and device-native text/email continues to work while chef modules are disabled. When permitted, enable chef features contextually in the existing recipe flow, with a clear distinction between free software use and optional paid food preparation by the separate business. An admin control for a feature does not itself establish that external regulatory approval exists.

### 34.8 Modular milestone gates and visual QA
Each feature is developed as a small working vertical slice with typed interfaces, isolated schema changes, unit/API/authorization tests, screenshot-recorded Playwright E2E tests, accessibility checks, and full cumulative regression tests before subsequent work. Run a **flag matrix** (OFF publicly, ON privately for permitted testers, rollout cohort, emergency OFF) across desktop/mobile and test direct protected API calls. Save ordered screenshots, full traces, CI artifacts, and visual diffs; redact sensitive information. Add tests preventing newly introduced chef data fields from appearing in public signup, telemetry, or user profiles while flags are OFF. Block release if the OFF state leaks private functionality or if a release lacks approvals.

### 34.9 Release acceptance criteria
- A newly created free account sees only released features; recipe sharing remains operational.
- Direct `POST` to chef/order/messaging/checkout APIs returns safe denial with flags OFF, even if a client fabricates an ON state.
- Privately approved staging users can exercise fully tested chef workflows with test data and mock payment providers.
- Admin changes to controlled flags are authenticated, authorized, auditable, and reversible; legal gates cannot be bypassed by a single ordinary admin toggle.
- No restricted chef data is requested, collected, or processed in public workflows before enabling and informing users.
- Staging and production remain isolated, and a production OFF-to-ON transition is gated by the defined approval process.
- Emergency disable blocks new actions while preserving and safely handling any existing commitments.
- Playwright produces screenshots/traces for OFF, ON, rollout, and rollback cases at every feature milestone.

**Priority precedence:** This section overrides Section 33 only on whether the unreleased chef capabilities are designed/built/tested privately; Section 33 continues to define what is accessible and what information may be collected in the free public launch.

## 35. OFFLINE-FIRST INGREDIENT CATALOG, LOCAL RECIPES & SAFE SYNCHRONIZATION (MANDATORY)

### Product contract
- Provide an installable PWA with service-worker-cached app shell and a versioned starter ingredient catalog available after successful first-time installation and download. First install, account authentication, and initial catalog provisioning require connectivity; do not promise offline access before provisioning.
- Starter catalog: begin with approximately 100–200 commonly used ingredients, carefully curated for reliable macro/micro nutrient coverage; bundle/seed normalized, source-cited nutrient values, source/record IDs, measurement units, cooked variants when verified, uncertainty markers, version/hash, and small optimized photographs where licenses permit. Do not mark missing nutrient values as zero. Present package size and explicit download state.
- Persist user favorites, recently used food records, cooking-method rules, downloaded instructional content, recipe drafts, saved recipes, and planned-vs-consumed meal logs to IndexedDB. Keep application JS/CSS/shell in service worker Cache Storage. Treat device storage as an offline replica, not the sole backup; handle browser eviction and storage quotas. Never cache session credentials, provider API keys, or sensitive support screenshots in the public cache.
- Search local foods first without any API request. Only search the full authoritative online catalog when connected; clearly distinguish `Device ingredients` and `Search all ingredients`. When offline, show a friendly message that additional foods require connectivity and allow a retry once online. Cache verified remote food records after retrieval. Local recipe modifications, portion scaling, and calculated nutrition work entirely offline using cached food/nutrient records and locally available calculation rules; surface missing data accurately.
- Save every user recipe edit and new recipe locally first, transactionally, then update UI optimistically. A visible unobtrusive state indicates `Saved on this device`, `Syncing`, `Synced`, or `Needs attention`. Saving locally must never falsely claim cloud sync. Ensure offline session recovery and crash resilience.
- Append local mutation events into a durable IndexedDB outbox with stable UUID operation IDs, entity IDs, device ID/pseudonymous client ID, base server version, payload schema version, creation time, and idempotency key. Replay in order per entity after connectivity and authentication are validated. Implement bounded exponential backoff with jitter, request deduplication, and safe retry after restarts. Treat browser online events only as hints; verify actual backend availability.
- Implement authenticated versioned sync API endpoints supporting batched pushes/pulls, pagination/cursors, server-assigned versions, idempotency, tombstones for deletes, and delta sync since a stored cursor. Server validates ownership, permissions, nutrients/calculation versions, and schema constraints. Do not rely on last-write-wins for conflicting recipe edits: detect concurrent modifications using version/ETag and let the user choose local copy, cloud copy, or save both. Never silently overwrite a different device's changes. Preserve edits when a session expires and offer reauthentication before synchronizing.
- Snapshots for saved recipes include precise food record and calculation rule versions; ingredient catalog updates do not silently rewrite historical meal intake. Display if newer reference data is available, and allow controlled recalculation with transparent provenance.
- Use structured migrations for IndexedDB and for server data, with rollback/recovery tests. On logout or account switch, wipe or cryptographically isolate account-specific IndexedDB data while retaining only public starter-catalog assets. On shared devices, prevent one account from accessing another account's offline recipes. Explain that local nutrition/meal histories on a device might be accessible to other people with access to the unlocked device, and provide `Clear offline data` control.
- Public recipe share UUIDs may be created online only. If sharing is requested offline, create a local share draft and ask to retry after sync; never invent an active share URL. Optional AI and image generation require external connectivity/provider access. Chef flags continue to be enforced server side and are not bypassed by offline operations.

### Tests and evidence gates
1. After one successful provision, load application, 100+ local foods and downloaded recipes in airplane/offline mode; edit an ingredient and verify immediate nutrient recalculation from cached data.
2. Searching a missing local ingredient while offline shows the local/online boundary without an unhandled exception or endless spinner; searching online retrieves and caches the record.
3. Edit/create/save multiple recipes and meal logs offline, close/reopen, then reconnect; verify outbox replay exactly once and consistent server state. Simulate connectivity flapping and duplicate requests.
4. Edit the same recipe on two devices while disconnected; reconnect both; verify a conflict UI rather than silent loss and ensure both versions can be recovered.
5. Trigger auth expiration while offline; retain local work, defer sync, require proper auth when online.
6. Test source-version upgrades and database migration without rewriting historical nutritional snapshots or losing drafts.
7. Confirm the 3-screen-transition UX target and persistent issue-reporting control in both online and offline mode; offline bug reports queue without uploading private screenshots until user authorizes the upload.
8. Playwright E2E suite uses browser context offline toggling, screenshots at each meaningful step, visual diffs, and traces. API integration tests verify idempotency and concurrency. Do not mark complete without visual proof and full regression.
9. Load-test starter-data download, D1 reads/writes and Worker CPU under realistic caching and sync scenarios, including bursts when many devices reconnect. Estimate storage budgets for R2 media and client quota limits.

**Release priority:** Core offline ingredient/recipe editing and safe synchronization are part of the free public MVP, not gated paid features. New features must support local-first flows where applicable or prominently explain that connectivity is required.

## 36. YOUR KITCHEN: BATCH SYNCHRONIZATION AND API-EFFICIENT LOCAL-FIRST WORKFLOWS (MANDATORY)

**Product center:** Make "Your Kitchen" the primary home for locally available favorite ingredients, the starter catalog, downloaded ingredient profiles and cooking variations, personally created recipes, meal plans, and consumed-meal logs. User-created recipes and local nutrient calculations must function without a network connection once ingredient records and app assets are available. Additional catalog searches, optional AI, and first-time downloads require connectivity. Explicitly distinguish saved-on-device from synced-to-account.

**Local write model:** Write edits immediately to IndexedDB with a stable client-generated UUID, device ID, logical operation ID, local timestamp, entity version, and pending-sync state. Keep a durable transactional outbox of user intent and coalesce superseded changes to the same entity (e.g. 20 edits to a recipe become one latest recipe update), without coalescing independent consumed-meal events or destructive actions. Repeated servings and meal logs must not be lost through inappropriate deduplication. Never transmit a partial recipe as authoritative if validation cannot be completed locally; present a draft state.

**Batch sync API:** Provide authenticated, versioned `POST /v1/sync/batch` with a bounded payload (configurable max operations and bytes), idempotency keys per operation, ordered dependency processing, per-operation status and error results, server-assigned versions, server cursor, and conflict responses. Provide `GET /v1/sync/changes?cursor=...` or cursor-based pull data included with a batch response. Apply server-side schema validation, authorization and feature-flag enforcement to **each** operation, within appropriate transactions. Chunk large batches, retry partial failures with exponential backoff and jitter, and do not replay successfully acknowledged operations. Sync favorites, recipe edits, and meal logs together where possible; synchronize public reference-food versions separately from personal data.

**Sync scheduling:** Trigger on reconnect, app resume/open, meaningful accumulated changes (short debounce), and explicit "Sync now". Allow an optional periodic sync while the app is open, but don't rely on browser background sync as the only delivery mechanism. Avoid needless requests when the outbox is empty and reference-version manifest is unchanged. Do not promise synchronization while all tabs are closed or the device is offline.

**Conflicts and safety:** Use optimistic concurrency with entity versions and ETags/expected revisions, protect against duplicate submissions and out-of-order updates, and never silently overwrite concurrent edits from two devices. Preserve both divergent recipe versions if automatic field-level merge is unsafe and prompt a friendly conflict resolution. Treat delete as a tombstone until acknowledged; support undo where feasible. Never merge logged-meal consumption events based solely on ingredients matching. Protect IndexedDB data from account switching; don't store API secrets in IndexedDB. Provide storage quota/eviction handling, export of locally unsynced drafts, and clear warnings if a change is only stored on the device.

**Bandwidth and cost:** Download a compressed, versioned starter ingredient library in a single/limited number of requests, lazy-fetch missing food records in batches, and store immutable sourced nutrient snapshots for offline recipe calculations. Bundle cooking-method templates and source metadata with offline assets. Quantify API requests, database rows read/write, bytes per sync, cache hit ratio, failed/retried operations and reconnect bursts. Favor batched lookups and sync but prioritize correctness and prompt persistence above minimizing requests.

**UX acceptance:** Home destination reads "Your Kitchen" or prominently features it; its first-level sections are My Ingredients, My Recipes, My Meal Plan, and Sync Status within the existing minimal navigation. Show small human-readable states: Saved on this device / Syncing / Synced / Needs attention. Offline searching clearly offers cached ingredients only, with a one-tap retry when connected. Users should complete common tasks within the existing three-transition guideline.

**QA release gate:** Unit tests for queue coalescing, lossless consumed-meal events, dependency ordering, idempotency, schema validation, and cursor pagination. API integration tests for duplicate submission, 413/429/500/timeout, stale versions, permission violations, and partial success. Screenshot-recorded Playwright E2E tests for offline create/edit/log, refresh, app reopen, reconnect batch sync, conflicting two-device recipe edits, forced server outage, storage/quota failure, and sync status. Inspect ordered screenshots and traces, run full regression, and retain evidence bundles for each milestone.
