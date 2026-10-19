# THE BETTER PLATE — PRODUCT REQUIREMENTS

**Version 3.4 | October 2026 | Status: requirements, not an implemented or approved product.**

This file defines **what must be true for the product**, not which framework, cloud, folder structure, or engineering sequence must be chosen. Read `AGENTS.md` for execution rules and `HISTORY.md` only for historical rationale. When there is a conflict, current requirements in this file override archived decisions. Agent may propose improvements to product flows but must not silently remove, downgrade, or redefine required capabilities.

## Product intent and immutable outcomes

- **Your Kitchen:** beautiful, photography-led, minimalist, mobile-first, free offline-first application. Starter ingredient bundle; save/download ingredients, recipes and cooking guides; local editing and deterministic nutrition preview; safely batch-sync planned and consumed meals when online. Never claim cloud sync until acknowledged.
- **Evidence-first nutrition:** trustworthy sourced food-composition records and education; trace each reported nutrient and explanation to provenance. Distinguish measured/reference values, computed estimates, unknowns and incomplete coverage. No medical diagnosis, false certainty, or LLM-generated nutrient facts.
- **Cooking confidence:** non-AI curated cooking instructions and cooking-method education, appropriate safety temperatures, method-specific preparation, oil added versus retained versus consumed, yield/retention uncertainties, and step-by-step accessible cooking UX.
- **Optional AI:** user-supplied OpenAI/Claude API access for companion navigation, recommendations and reviewable recipe edits; independent nutrition/safety engines remain authoritative. Photorealistic image generation only through a capable provider, with clear labeling.
- **Excellent experience:** bright, restrained, editorial-quality real or photorealistic food imagery, no cartoons, accessible and nonjudgmental copy, progressive disclosure, and core journeys normally within three screen transitions.
- **Privacy-minimal free launch:** email, optional display name, planned and explicitly logged consumed meals; only essential security, consent and operational metadata. No mandatory phone, address, clinical history, demographics, checkout, subscription or in-app chef operations at initial public launch.
- **Progressive release:** chef messaging, inquiries, quotes, ordering, checkout and delivery are privately developed/tested modules, publicly OFF until separately approved, with both backend and frontend enforcement. Recipe UUID sharing and native handoff work publicly at launch.
- **QA and feedback:** a report-issue affordance on every screen, privacy-reviewed optional screenshot and readable recent activity, correlation IDs, full QA screenshot/trace evidence at milestones, automated API validation and full release regression.
- **Operations:** independently deployable documented backend API usable by multiple clients; modular monolith, fully managed infrastructure with no user-operated server maintenance, low cost, secure data handling, tested backups and recovery.

**Hard outcomes are nonnegotiable; technology choices are delegated to the agent under `AGENTS.md`.** All illustrative thresholds or counts (starter catalog size, cache limits, screen transitions, response-time targets) are targets or initial design guidance unless they directly encode a product safety or public release requirement. The agent must preserve equivalent usability and measurable outcomes if it changes implementation details.

## 1. Definition of product and user journeys

**Users:** adults who want enjoyable food, simple cooking education and estimated nutrition exploration; busy students, home cooks, athletes, kosher-aware households and curious learners. Avoid assuming diets are medical treatment. Existing private-chef business is a separate operational relationship.

**Primary journeys (target ≤3 navigational transitions; preserve necessary security confirmations):**

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

## 2. Functional domains and contracts

### 2.1. Identity and privacy
Email verification, authentication and recovery through vetted provider compatible with selected hosting; passkeys/OIDC as feasible, admin MFA mandatory. Session revocation, safe CSRF/cookies/CORS, per-record ownership, rate limiting, deletion/export, privacy notice versions and consent events. No phone/address fields public; no collecting data for future disabled capabilities. Clear local account data on logout/account changes. Exclude children under 13; adults-only product policy, no unnecessary date-of-birth capture.

### 2.2. Food Knowledge Base
Official USDA ingestion of normalized food records with canonical external IDs, food type and state, nutrient IDs, per-100g unit, portions and density, source/version/URL/retrieval date, completeness and missing flags, allergen uncertainty and kosher-status non-certification. Start with 100–200 packaged, versioned starter foods, selectively expand to 300–500 curated foods, then user-demand catalog. Source data must be properly imported; do not use invented nutrient figures outside labeled test fixtures. Source manifests and delta updates. Search index, offline favorites/recent caches, online-only missing items, batch lookup.

### 2.3. Deterministic Nutrition Engine
Typed pure functions for amounts and units; recipe sum per ingredient/serving; cooked/raw yield and official retention factors; measured discarded or retained oils, added sauces, recipe state. Return known/missing per nutrient with quality and provenance; preserve historical source snapshots. Support reference Daily Values vs properly labeled general DRI categories; don't assume user demographics. Daily and seven-day views strictly separate plans from logs, and preserve partially logged days as incomplete. No invented body absorption, dosage, nutrient remediation, or false “complete nutrition” guarantee.

### 2.4. Cooking Knowledge Base & Guidance
Curated ingredient × method templates with description, equipment, temperature/time range, thermometry, unsafe methods exclusion, prep order, cook timing, safe handling, storage; method names raw, boiled, steamed, pan-fried, deep-fried, air-fried, baked, roasted, grilled, sautéed, stir-fried, microwaved, braised, poached, pressure-cooked, slow-cooked, blanched, and simmered. Additional methods may be added when appropriate, with the same evidence, safety and testing requirements. Plain-language why/how differences; meals editable by method, oil type/volume/mass, raw vs cooked measurement. Tested curated instructions accessible without AI; untested combinations clearly marked. Cooking-mode offline and screenshot-tested.

### 2.5. Local-first Your Kitchen
Versioned bundle of starter food records and offline cooking instructions, delivered as static/cached assets; IndexedDB local records for downloaded foods, favorites, recipes and meal plans/logs, and durable outbox. Local-first transactional saving and browser refresh persistence. In-memory hot cache for currently active ingredients. Default locally calculated live updates without per-keystroke APIs. Storage quota/eviction recovery, privacy isolation on account switch, manual export of unsynced drafts.

### 2.6. Sync engine
A documented versioned batch-sync operation with bounded operations, UUID idempotency keys, per-operation statuses, conflict and server version metadata, ordered entity dependencies; pull via cursor and tombstones. Coalesce superseded edits but not separate meal-consumption events. Sync online at app resume, reconnection, short debounce after meaningful changes, or user Sync now. Never claim cloud sync before acknowledgement. Conflict UI offers keep local/cloud/both; don't silently overwrite. Optional background sync cannot be relied upon if app closed.

### 2.7. Recommendations and educational claims
Constraints-first deterministic recommendation ranking; avoid allergen assumptions, dietary conflicts and medical claims. Explain why a candidate fits a user-selected goal; offer swaps not prescriptions. Evidence claim registry with source, exact URL/DOI when checked, publisher, retrieved/reviewed date, evidence type, editorial version. Trusted server ingestion and citation verification, scheduled freshness checks; never make “live verified” claim if offline/cached. Each nutrient has friendly basic explanation and optional scientific details. Flag sources whose scientific guidance varies by population.

### 2.8. AI Companion (optional BYOK)
Secure provider-key entry/test/disconnect, encrypted at rest, never expose provider keys to browser/local storage/logs; support OpenAI and Anthropic through provider adapters. AI tools are typed, bounded, authorization and flag checked; suggested edits, substitutions, navigation, meal plans and cooking instructions are reviewable proposals, not automatic mutations. No client/LLM ability to run arbitrary internal HTTP/database commands. Prompt-injection red teaming. Rate/cost budget user controls; compatible image provider adapter for photorealistic recipe images, generated-image disclosures, recipe-image provenance, no guarantee of exact appearance. Non-AI fallback complete.

### 2.9. Recipe share and social
Revocable read-only recipe snapshots with unguessable UUID public link, scoped shared fields and expiry if configured; no dietary history, user identity, private email or AI key. Sanitize and validate rich text; link creation online only; native web share with copy/SMS/email fallback. Public metadata image and Instagram-compatible native share where supported, not an unsupported direct-post promise. Warn any link holder can read until revoked. Support independent recipe revision and snapshot lifetime.

### 2.10. Chef module, private future capability
Implement modular interfaces and staging-tested customer inquiry, chef messaging, quote, preparation scheduling, order/payment/refunds, delivery and staff console behind default-OFF flags. Public users initially have only external link sharing. Future opt-in data (delivery address/phone/payment) must be collected just-in-time after legal/privacy/operational approval, not in current accounts. Strong server enforcement of OFF, staged allowlist, two-person approval for regulated/high-impact features, audit logs, kill switch, and rollback obligations. Use fake providers and test data for unreleased systems.

### 2.11. Feedback, support and observability
Persistent report button on every public and admin screen, including error states. Allow bug, general feedback, suggestion. Show prepopulated user-readable event sequence (e.g. opened favorites → salmon recipe → swapped broccoli for cauliflower → save failed) without raw keystrokes, health logs, secrets or unintended content. Optional user-approved screenshot with privacy mask/preview/remove. Send correlation ID, sanitized stack/exception, app/build version, route and device class. Support offline queued reports and admin triage statuses. Traces, rate/latency metrics, errors and resource budgets with data minimization.

---

---

## 3. API-first architecture and interfaces

**Backend is the system of record.** OpenAPI 3.1 checked into repository, versioned REST `/v1` API; generated typed browser/client library, machine-readable examples, strong runtime validation, public API docs with redacted examples. Backend can be tested with curl/Postman/HTTP integration suite before any screen exists. No UI-only authoritative business logic; shared pure nutrition library can calculate locally but server revalidates on save/sync.

**Illustrative API operations (not mandatory URL spelling or grouping):**

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

**Illustrative backend module boundaries (organize differently if equally isolated):** identity, catalog, nutrients, recipe, cooking, logging, planning, sync, education/evidence, recommendation, AI, sharing, feedback, flags, admin, chef (OFF). Each owns its tables and API contracts; cross-module operations use typed application services, not direct unrestricted table access. No microservice gateway, distributed event mesh, or Kubernetes.

**Concurrency & jobs:** asynchronous I/O for web requests; durable retry/idempotency-aware background operations for source imports, image generation, audits and notifications. Use an implementation-appropriate, durable background-job adapter; choose a managed queue or scheduled jobs only when workloads require them. No unbounded work on constrained request runtime. No repeated backend calls for ingredient sliders; preloaded ingredient records drive local computations. Instrument real CPU and DB budgets.

---

---

## 4. Data schema requirements (logical, implementation agnostic)

- Identity: `users`, `profiles`, `sessions/provider_refs`, `privacy_notices`, `consent_events`.
- Catalog: `food_sources`, `food_items`, `food_portions`, `nutrients`, `food_nutrients`, `ingredient_aliases`, `catalog_manifests`, `source_revisions`.
- Cooking: `methods`, `ingredient_method_rules`, `recipe_instruction_templates`, `yield_factors`, `retention_factors`, `food_safety_sources`.
- Personal kitchen: `user_favorite_foods`, `recipes`, immutable `recipe_revisions`, `recipe_ingredients`, `planned_meals`, immutable/idempotent `consumption_events`, `sync_operations`, `sync_cursors`, `deletion_tombstones`.
- Education: `evidence_sources`, `evidence_claims`, `recommendation_rules`, `educational_content`.
- AI: encrypted `ai_credentials`, `ai_threads`, `ai_proposals`, `ai_usage`, `generated_images`.
- Sharing: `share_snapshots`, `share_revisions`, `share_revocations`.
- Operations: `feedback_reports`, `activity_summaries`, `audit_events`, `feature_flags`, `flag_approvals`.
- Unreleased chef: `chef_inquiries`, `chef_messages`, `chef_quotes`, `chef_orders`, `chef_fulfillment`, `chef_payments`, `chef_delivery`; isolated, protected and never accessed by public OFF flow.

Use stable UUIDs, version/time columns, indexes for ownership/date/query, immutable nutrition snapshots, referential integrity, safe migrations, privacy deletion/export, source attribution and per-user scoping. Use the selected relational database’s supported constraints, transaction semantics, locking behavior, and independently validated migration design. No fake synchronous cross-database transaction assumption.

---

---

## 5. Security, privacy, regulatory and evidence controls

Threat-model public sharing, user data exposure, CSRF/XSS, injection, malicious recipe imports, SSRF, BYOK key theft, AI prompt injection, weak roles, malicious upload, unindexed query amplification and unexpectedly expensive data access, stale offline sessions, and flag bypass. Validate all inputs, HTML sanitize, use HTTPS/HSTS/CSP, encrypted secrets, least-privilege admin, log redaction, access audits, rate limiting and dependency scans. No raw captures of private diaries in third-party replay products; screenshot uploads optional and explicit. Do not use personal data for unrestricted unidentified future purposes. GDPR/state privacy applicability and FTC health/privacy assessment require counsel based on actual service/data flows. No claim that free pricing or citation to USDA transfers all legal responsibility. The app is educational, non-clinical and adult-targeted. Clearly state uncertainty, no treatment or guaranteed outcomes.

Source composition data vs health claims vs cooking-safety instructions have independent source review and version controls. Include evidence provenance and expiry policies. A source reference is not equivalent to a live verified source; offline copy carries last checked date. Track image licenses, whether generated, and user permissions.

---

---

## 6. Visual design and interaction acceptance

- 4 root destinations; 3-screen-transition core task target; contextual editing and sheets preferred to new pages.
- Warm white `#FAFBF9`, white surfaces `#FFFFFF`, deep charcoal `#17211E`, restrained sage `#719B87`, accessible neutral grays. Avoid decorative gradients, dense cards, cartoon produce, whimsical mascots and uncontrolled colors. Use clean typography (Inter or appropriately licensed system font); 44px-ish touch targets.
- Real food photography or realistic images, truthful ingredient depiction, editorial light and realistic portion sizes; label AI-generated images, never promise exact appearance.
- Simple default nutrient bars with *Estimated* cue; optional “Learn” and “Sources” drawers. Avoid misleading single “nutrient completeness” score. Unknown not colored as zero; levels against reference aren't diagnoses.
- Short copy, no guilt/shame/red warning for treats. Show precise sync statuses “Saved on this device”, “Syncing”, “Synced”, “Needs attention”, and a legible offline search limitation.
- Accessibility WCAG 2.2 AA target, reduced-motion support, keyboard/screen reader labels, high contrast; English primary and Spanish-ready content keys (translate P0 where reasonably feasible and test). Tests on narrow/mobile and desktop layouts.

---

---

## 7. Final test catalog and release checklist

**Contract tests:** OpenAPI validates actual API responses; consistent pagination/versioning/errors, auth enforcement, rate limits, no accidental direct DB bypass. USDA identifiers and labels tested against imported, attributed records. All deterministic calculation tests include missing nutrient, fractional servings, raw/cooked weights, oil added vs retained, fried-entry double count, partial weekly logs, timezone changes, official source updates and historical preservation.

**Security tests:** unauthorized cross-user recipe access, leaked public link fields, stolen/revoked share, XSS on recipe names, CSRF, source SSRF, key exfiltration, prompt injection, forged feature flags, admin permission escalation, sensitive screenshot capture. Keys never in JS bundles, browser IndexedDB, or telemetry.

**Offline/sync tests:** cold first load online, repeat load airplane mode, starter catalog access, local recipe edits, device reboot/refresh, duplicate queued operations, reconnect storms, partial batch success, two devices editing same recipe, explicit merge choices, account switching, quota eviction, offline report approval, active link creation requiring network.

**Release readiness:** zero critical/high unresolved security issues; QA evidence bundle complete and inspected; product analytics minimal and privacy reviewed; documented risk and source-quality gaps; restored-backup drill passed; rollback runbook verified; production smoke tests and monitoring complete; billing and resource-budget alerts active; legal/privacy review gate recorded; public feature flags OFF for chef operations; operational incident owner identified. Never represent product as released merely because local tests succeed.

---

### 7.1. Product acceptance and traceability

Every functional requirement above must have a testable status: `verified`, `implemented-unverified`, `staging-only`, `blocked`, or `not-started`. A coding agent must map requirements to tests and evidence and cannot treat absence of a test as proof of passing. Product changes require an explicit decision record and user authorization for material feature removal, data expansion, paid activation or weakened scientific/safety behavior.

**Historical requirement coverage:** The complete earlier 36-section source is preserved in `HISTORY.md` for discovering edge cases. Consult it when implementing a feature, but its obsolete infrastructure, demographics, public chef release, and prior agent directives are not authoritative. If an old detailed edge case is compatible with this file, retain it. If uncertain whether a historical edge case is a product invariant, document the uncertainty rather than silently discarding it.


## 8. Public pilot release boundary

The first public release is an intentionally small, fully tested **Your Kitchen** vertical product: accounts, locally stored and synchronized recipes, source-attributed starter foods, deterministic macro/micronutrient estimation, cooking-method education and safe instructions, oil handling with disclosures, planned and consumed meals, and feedback reporting. Deliver this complete coherent journey before treating AI, image generation, additional online catalog breadth, or private chef ordering as release-critical. Any publicly offered link sharing must be revocable and reviewed for privacy. Retain advanced functionality as explicit future requirements—not abandoned scope. See AGENTS.md for test-gated delivery and Railway-preferred CI/CD.
