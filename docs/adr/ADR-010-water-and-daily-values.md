# ADR-010: Water, FDA Daily Values on the You page, and a goal calculator that stores nothing

**Status:** accepted (water, Daily Values); calculator pending source access · **Date:** 2026-10-21 · **Decided by:** owner (scope, adults only, inputs never stored), agent (design)

## Context

The owner asked to compare goals and what was eaten with FDA recommended amounts, to track water, and to ask about activity level when working out goals. FDA Daily Values (21 CFR 101.9) are fixed label references for a 2,000-calorie adult diet; activity does not change them. Activity changes energy and water needs, and the published equations (National Academies DRIs) also need sex, age, height and weight. PRODUCT.md rules out collecting demographics, and ADR-008 kept goals to numbers the person typed.

## Decisions

1. **Daily Values are a reference, never a target.** The You page chart shows the FDA Daily Value next to each daily goal (an "FDA" marker row) and lists nutrients without a daily goal under "Other nutrients compared with FDA Daily Values", with the percentage of the Daily Value and a link to the FDA page. Unknown stays unknown; partial reads "at least".
2. **Water drunk is its own record.** `water_logs` (migration 017) holds millilitres (1–5000), the local day and the time. Drinks are create-only events like eaten meals: sync ops `water.create` and `water.delete`, change-feed entity `water_log`, never coalesced, removed with a tombstone, read with `GET /v1/water` (≤31 days), included in the account export. On the device they live in a new IndexedDB store (schema version 5) and save offline first.
3. **Water in food is shown separately as an estimate.** The catalog now carries USDA nutrient 1051 (Water, g) per food. Food water is summed from logged meals as weighed; water a food absorbs while cooking (pasta, rice) is not counted, and the screen says so. 1 g of water is shown as 1 ml.
4. **Water goals use the existing goal model.** A goal on nutrient `water` (unit g, shown as ml) compares with drinks plus food water per day (`waterIntake` in `@betterplate/nutrition`), on the Goals screen, the You page chart and the connector's goal progress.
5. **Calculator (owner decision 2026-10-21, adults only).** A "Help me calculate" sheet on Goals may ask sex, age, height, weight and activity level, compute suggested goals in the browser from the National Academies DRIs (energy, macronutrient ranges, water, optionally vitamins and minerals), and save only the goals the person accepts. Inputs are never sent to the API, never written to IndexedDB, localStorage or the activity log, and are gone when the sheet closes. No calculator for child profiles, no pregnancy or medical options; results are labeled estimates with sources. **Not built yet:** the equations and tables must be copied from the published sources, which this environment cannot reach (network policy blocks nap.nationalacademies.org, ncbi.nlm.nih.gov and ods.od.nih.gov). No values are entered from memory.

## Alternatives considered

- Store activity level or body data to recompute goals: rejected (expands data collection; the owner chose a calculator that stores nothing).
- Count drinks as eaten meals with a "water" food: rejected (mixes drinks into meal lists and nutrient days, and would make water-only days look like partially logged food days).
- Hide water in food: rejected by the owner, who wanted both shown separately.

## Consequences

- The privacy data map gains a `water_logs` row (owner request 2026-10-21). Goals remain the only stored output of the calculator.
- Recipe nutrition panels now list water from the catalog like other nutrients.
