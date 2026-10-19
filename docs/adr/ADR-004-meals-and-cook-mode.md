# ADR-004: Planned and eaten meals, % Daily Value, cook mode

**Status:** accepted · **Date:** 2026-10-19 · **Decided by:** agent (owner asked for autonomous completion of the pilot)

## Context

PRODUCT.md §2.3/§2.6 require planned meals and explicitly logged consumed meals, strictly separate, synced in batches, with daily and seven-day views that keep partial days incomplete. §2.4 requires cooking guidance with safe temperatures and no invented safety claims. §6 asks for calm nutrient bars against references without diagnosis.

## Decisions

1. **Two tables.** `planned_meals` (editable, versioned, conflict-checked like recipes) and `consumption_events` (create-only, id = idempotency key, retraction = tombstone with content cleared). A plan can never be summed as food eaten because the code paths never mix them (`sumMeals` only receives logs).
2. **Logs carry a recipe snapshot.** The client sends the recipe as eaten; the server recomputes nutrition from catalog records and freezes it with the catalog version. Later recipe or catalog edits never rewrite history, and a log does not depend on the recipe being synced first.
3. **Calendar day is the eater's own.** Logs store `localDate` plus `eatenAt` with its offset; days are grouped by `localDate`, so travel does not move past meals.
4. **No "complete day".** The app never claims a day is complete: today is "in progress", days with unmarked plans say so, and seven-day views show per-day sums and how many days have logs, never averages that treat missing meals as zero. An explicit "this day is complete" marker can be added later without migration of existing data.
5. **% Daily Value** uses the FDA reference Daily Values (21 CFR 101.9) copied from the FDA page with its date (`packages/nutrition/src/daily-values.ts`). Calories (no DV) and total sugars (DV covers added sugars only) are shown without a percentage. Percentages are labelled as reference amounts, not targets.
6. **Cook mode uses the person's own steps.** Steps are split from their method text and timers come from durations they wrote. Safe minimum internal temperatures come only from the FoodSafety.gov chart (last reviewed 2024-11-21), mapped from USDA food groups; foods outside the chart get no temperature. Curated method templates stay `not-started` until sourced content exists.

## Alternatives considered

- One `meals` table with a status column: rejected, too easy to sum plans as eaten.
- Client-computed log nutrition accepted by the server: rejected (AGENTS.md: server revalidates before authoritative persistence).
- Generating cooking steps or temperatures: rejected (no fabricated safety claims).

## Consequences

- Sync protocol 1 gained four operation types and two change-feed entities; old recipe operations are unchanged.
- Local IndexedDB schema version 2 adds `plans` and `logs` stores; existing data is kept.
