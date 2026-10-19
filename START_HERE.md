# THE BETTER PLATE — START HERE

This is the entry point for a coding agent. Supply the entire directory/repository, not just this file.

## One-shot prompt

> You are the autonomous lead engineer for The Better Plate. Read `PRODUCT.md` (binding product outcomes) and `AGENTS.md` (binding decision authority, safety and verification). Consult `HISTORY.md` only for context and compatible historical edge cases, not as current implementation instructions. Inspect the environment and repository, define a measured dependency-aware plan, choose and document a simple fully managed API-first architecture, then autonomously build the most complete working product achievable. Preserve all capabilities and nonnegotiable privacy, nutrition, offline, UX, QA and feature-release requirements. Implement in small real vertical slices, test APIs independently of UI, capture and inspect screenshots/traces of critical user journeys, run focused regressions during development and full suites at milestone gates, and maintain honest feature/evidence ledgers. Pivot technology or sequencing when evidence warrants, recording important tradeoffs. Never invent sources, test results, production credentials, legal approvals, or deployment. Never incur unapproved costs or enable future chef commerce publicly. Leave reproducible tested checkpoints and clearly state unresolved blockers.

## Contents

- `PRODUCT.md` — authoritative features, user experience, data and behavior.
- `AGENTS.md` — autonomous implementation and testing contract.
- `HISTORY.md` — archived full v2 and original 36 sections, for traceability.

The agent is free to make implementation decisions. Product outcomes and independently verifiable acceptance criteria—not old stack choices—define success.

## Required FIRST step — Owner preflight

Before autonomous implementation, audit the environment and prepare `docs/OWNER_PREFLIGHT.md` as **one consolidated, minimal list of things only the owner can supply or approve**, divided into: needed now, needed for staging, needed for production, and optional. Include repository/workspace access, hosting/billing approvals, credentials and secrets, auth/email domain requirements, DNS, data providers, legal release approvals and budget limits, including an explicit **maximum monthly recurring spend and per-environment estimate** (Railway service resources, databases, backups and staging). No billable provisioning before approval. Generate and validate `.env.example` and `docs/config-inventory.md`; use managed hosting/GitHub secrets for real credentials, and never ask users to paste secrets in chat or commit a live `.env`. Read the preflight and secrets rules in `AGENTS.md`. After owner approval/grants, work autonomously through tested increments; do not let optional production-only inputs block safe local development. Report missing prerequisites clearly.

**Current deployment preference:** GitHub Actions + Railway (independent web/API/worker services, Railway PostgreSQL, staging screenshot QA and gated production promotion). The agent may pivot with documented evidence and owner approval for paid provisioning. First verified public pilot scope is Your Kitchen, offline nutrition/cooking/sync; other required modules stay in the ledger for staged expansion.
