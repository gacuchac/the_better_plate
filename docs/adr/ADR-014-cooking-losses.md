# ADR-014: Cooked or raw ingredients and USDA nutrient retention

**Status:** accepted (owner request, Gabriel, 2026-11-17: "the nutritional values should be on cooked food because they get cooked in the cooking process. a salad stay raw if it doesnt have a cooking step ... this should be in the mcp"; clarified: "it's more for micro nutrients")

**Context:** Recipes weigh ingredients raw and nutrition used raw USDA values, so a boiled spinach soup showed the vitamin C of raw spinach. Most recipes are written by chat agents through the MCP connector, which said nothing about cooking.

**Options compared:**
- **A, swap in USDA's cooked food entries:** rejected. Those are per 100 g of cooked food, which holds a different amount of water, so using them at the raw weight misstates every total (100 g dry pasta is 371 kcal, 100 g cooked pasta 158 kcal), and many foods have no cooked entry.
- **B, USDA nutrient retention factors applied to raw values (chosen):** the method USDA itself uses for recipe calculation. Energy and macros are not adjusted (USDA publishes no factors for them); vitamins and minerals are.
- **C, retention plus yield (weight change):** deferred. Yield only matters for "per 100 g of the cooked dish", which the app doesn't show, and USDA yield factors exist only as a PDF.

**Decision:** B.
- Data: USDA Table of Nutrient Retention Factors, Release 6 (2007), imported by `scripts/usda/import_retention.py` in GitHub Actions to `data/catalog/retention-factors.json` (270 codes, file hash kept), and generated into `packages/nutrition/src/retention-data.ts`. Nutrients adjusted: calcium, iron, magnesium, potassium, sodium, zinc, vitamin C, vitamin B12, folate (DFE, from USDA folate total) and vitamin A (RAE, from USDA vitamin A RE). Vitamin D has no factor and stays raw.
- Each ingredient carries `cooking: { state: raw | cooked, method, source: stated | inferred }` with 17 methods. `packages/nutrition/src/retention.ts` maps USDA category + description + method to one USDA code (finfish split at 5 g fat; foods USDA already lists as cooked or canned use the group's "reheated" code; frozen vegetables use "cooked from frozen"). Groups with no code (oils, spices, breads, sweets, mixed dishes) keep raw values and the recipe says which ingredients weren't adjusted. Cooking oil is never adjusted.
- MCP `save_recipe` requires `cooking` on every ingredient and rejects a missing state, or a cooked one without a method, with a message saying how to decide from the steps. `get_recipe` returns each state.
- A save without a state (older app versions, the REST API) is filled on the server by guessing from the method text (`cooking-state.ts`, English and common Spanish words) and stored as `inferred`. The editor shows the guess and lets the person confirm or change it.
- Existing recipes: a one-time backfill on deploy (`apps/api/src/db/backfill.ts`, recorded in `data_backfills`, migration 022) fills guessed states, recomputes nutrition, bumps the version and keeps the old version in `recipe_revisions`. Meals already logged keep the nutrition they were logged with.
- Engine version 2.0.0.

**Consequences:** vitamin and mineral totals drop for cooked recipes; energy and macros don't change. The food-group mapping is ours (quinoa and other grains use USDA's rice codes) and is tested against the USDA file. Guesses from free text will sometimes be wrong; they are marked and editable. No feature flag: it changes how an existing number is computed, not a new feature, and dev is where the owner reviews it. Revert by restoring engine 1.x (retention skipped) — stored states are harmless without it.
