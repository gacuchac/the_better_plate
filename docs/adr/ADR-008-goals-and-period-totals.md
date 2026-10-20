# ADR-008: Consumption goals and period totals

**Status:** accepted · **Date:** 2026-10-20 · **Decided by:** owner (goals stored on the server and synced), agent (design)

## Context

The owner asked for totals of macro- and micronutrients over chosen periods on the You page, and for goals with start and end dates per day, week or month. Goals are about consumption only, never body data such as weight. Until now, daily targets lived only in the browser's `localStorage`. PRODUCT.md §2.3 and AGENTS.md forbid treating plans as eaten, treating not-reported as zero, computing targets from body data, and changing data collection without approval. The owner approved storing goals on the server.

## Decisions

1. **Goal shape.** Each goal has a nutrient key and unit (checked against the catalog), and a kind: `at_least` (min), `at_most` (max) or `between` (both). It also has a period (`day`, `week` running Monday to Sunday, or calendar `month`), `startDate` and an optional `endDate`. No free text and no body or health fields. The limit is 50 goals per person.
2. **Server-stored and synced like plans.** Goals live in the `goals` table (migration 014), versioned with conflict checks and tombstones through sync protocol 1 (`goal.put`, `goal.delete`, change-feed entity `goal`). They are read with `GET /v1/goals` and included in the account export. On the device they are in a new IndexedDB store (schema version 3).
3. **Pure progress math.** `packages/nutrition/src/goals.ts` computes period windows (clipped to the goal's dates), totals from logged meals only, and a status of met, below, above or no data. It flags partial data when some logged meals don't report the nutrient, so the amount is a lower bound. It also reports how many recent ended periods were met. The same functions run in the browser, the API (connector) and tests.
4. **Period totals.** `summarizePeriod` returns, for each nutrient, the total and the average per *logged* day, plus how many days have logs. It also flags the range as incomplete when some days have nothing logged. Days without logs are never averaged in as zero. `GET /v1/nutrition/summary` serves the same result for 1–366 days.
5. **Neutral wording, person's own numbers.** The UI says "within / under / over your goal" without red or warnings. The companion and the connector can read totals and goals. They may set a goal only with numbers the person stated, and never suggest, calculate or judge amounts. Deleting a goal needs the person's confirmation.
6. **Old device targets move once.** On first sign-in after this change, any old `localStorage` targets become daily goals starting that day (`at_most` for sodium, saturated fat, total sugars and cholesterol, `at_least` otherwise). They are then removed from the device. Percentages on nutrient panels use the daily goals in effect today, comparing with the lower bound, else the upper.

## Alternatives considered

- Keep goals on the device only: rejected by the owner (goals should follow the account).
- Rolling 7-day weeks: rejected for goals (calendar weeks and months match how people talk about them). The totals card still offers rolling 7 and 30 days.
- Averages over all days in the range: rejected (it treats unlogged days as zero).

## Consequences

- The privacy data map gains a `goals` row. This expands data collection and was approved by the owner on 2026-10-20.
- The AI tool `set_targets` is replaced by `get_summary`, `list_goals`, `set_goal` and `delete_goal`, and the companion's navigate target `targets` becomes `goals`. The old `#/targets` link still opens Goals.
