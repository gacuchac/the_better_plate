# ADR-010: Water, FDA Daily Values on the You page, and a goal calculator that stores nothing

**Status:** accepted · **Date:** 2026-10-21 · **Decided by:** owner (scope, adults only, inputs never stored), agent (design)

## Context

The owner asked to compare goals and what was eaten with FDA recommended amounts, to track water, and to ask about activity level when working out goals. FDA Daily Values (21 CFR 101.9) are fixed label references for a 2,000-calorie adult diet; activity does not change them. Activity changes energy and water needs, and the published equations (National Academies DRIs) also need sex, age, height and weight. PRODUCT.md rules out collecting demographics, and ADR-008 kept goals to numbers the person typed.

## Decisions

1. **Daily Values are a reference, never a target.** The You page chart shows the FDA Daily Value next to each daily goal (an "FDA" marker row) and lists nutrients without a daily goal under "Other nutrients compared with FDA Daily Values", with the percentage of the Daily Value and a link to the FDA page. Unknown stays unknown; partial reads "at least".
2. **Water drunk is its own record.** `water_logs` (migration 017) holds millilitres (1–5000), the local day and the time. Drinks are create-only events like eaten meals: sync ops `water.create` and `water.delete`, change-feed entity `water_log`, never coalesced, removed with a tombstone, read with `GET /v1/water` (≤31 days), included in the account export. On the device they live in a new IndexedDB store (schema version 5) and save offline first.
3. **Water in food is shown separately as an estimate.** The catalog now carries USDA nutrient 1051 (Water, g) per food. Food water is summed from logged meals as weighed; water a food absorbs while cooking (pasta, rice) is not counted, and the screen says so. 1 g of water is shown as 1 ml.
4. **Water goals use the existing goal model.** A goal on nutrient `water` (unit g, shown as ml) compares with drinks plus food water per day (`waterIntake` in `@betterplate/nutrition`), on the Goals screen, the You page chart and the connector's goal progress.
5. **Calculator (owner decision 2026-10-21, adults only).** "Help me calculate" on Goals asks sex, age (19–110), height, weight and activity level, computes suggested daily goals in the browser (`packages/nutrition/src/estimate.ts`), and saves only the goals the person keeps. The inputs live in the sheet's component state: never sent to the API, never written to IndexedDB or localStorage, never put in the activity log, gone when the sheet closes (an E2E test checks the requests, storage and sync payload keys). Suggestions, each editable and removable before saving:
   - **Energy:** the National Academies 2023 EER equations for adults (Table S-3; for a weight-stable adult EER = TEE), by sex and the four activity levels, rounded to 10 kcal. The goal is the estimate plus or minus the equation's reported RMSE (339 kcal men, 246 kcal women), labeled as steady-weight energy, not a loss or gain target. Activity descriptions come from Table 7-1 and the PAL ranges from Table 5-4 of the same report.
   - **Protein, fat, carbohydrate:** the adult Acceptable Macronutrient Distribution Ranges (protein 10–35%, fat 20–35%, carbohydrate 45–65% of energy) turned into grams at 4, 9 and 4 kcal per gram; the lower end of protein and carbohydrate is held at the adult RDA (56/46 g protein, 130 g carbohydrate) when higher.
   - **Fiber:** the Adequate Intake for sex and age band (38/25 g to age 50, 30/21 g from 51).
   - **Water:** the Adequate Intake for total water (3.7 L men, 2.7 L women), which counts food, drinks and drinking water together, matching how water goals are measured.
   - Values were copied from the National Academies Press pages (retrieved 2026-10-21) and are cited in the code and the sheet. No calculator for child profiles, pregnancy or breastfeeding; inputs outside the equations' range are refused, not extrapolated.
   - **Vitamins and minerals (added 2026-10-21):** offered in a separate, unticked group, needing only sex and age. Eleven nutrients the catalog tracks: calcium, iron, magnesium, zinc, vitamins A (RAE), C, D and B12, folate (DFE), potassium (Adequate Intake) and sodium. Source: Appendix J of *Dietary Reference Intakes for Sodium and Potassium* (National Academies, 2019, doi 10.17226/25353), the newest compiled tables; calcium and vitamin D come from the 2011 report and potassium from 2019. Sodium is the Chronic Disease Risk Reduction Intake ("reduce intakes if above 2,300 mg"), saved as a "no more than" goal, not a target. A search found no newer vitamin or mineral values. Nutrients the catalog does not track (vitamins E, K, B6, B-vitamins other than B12, phosphorus, selenium and others) are not offered; adding them needs a catalog import change.

## Alternatives considered

- Store activity level or body data to recompute goals: rejected (expands data collection; the owner chose a calculator that stores nothing).
- Count drinks as eaten meals with a "water" food: rejected (mixes drinks into meal lists and nutrient days, and would make water-only days look like partially logged food days).
- Hide water in food: rejected by the owner, who wanted both shown separately.

## Consequences

- The privacy data map gains a `water_logs` row (owner request 2026-10-21). Goals remain the only stored output of the calculator.
- Recipe nutrition panels now list water from the catalog like other nutrients.
