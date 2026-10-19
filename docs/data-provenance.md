# Data provenance

## Food composition: USDA FoodData Central, SR Legacy
- **What:** 149 foods (requested 150; `Crustaceans, shrimp, mixed species, raw` had no exact match and was left out). Snapshot `data/catalog/starter-catalog.json`, version `usda-sr-legacy-2026-10-19-a0e32df9`, retrieved 2026-10-19T13:41:26Z. Report: `data/catalog/IMPORT_REPORT.md`.
- **How:** `scripts/usda/import_starter.py` resolves each exact description in `scripts/usda/starter_foods.txt` via the official FDC search API (`dataType: SR Legacy`), then fetches full records. It ran in GitHub Actions (`.github/workflows/catalog-import.yml`) with the repository `USDA_API_KEY` secret because cloud agent sessions cannot reach USDA hosts.
- **Kept per food:** FDC ID, description, category, NDB number, publication date, household portions with gram weights, 19 tracked nutrients per 100 g exactly as published, source URL `https://fdc.nal.usda.gov/food-details/<id>/nutrients`, retrieval timestamp.
- **Not reported ≠ zero:** nutrients USDA does not report are omitted, and the engine treats them as unknown. Reported zeros stay zero.
- **License:** FoodData Central data is public domain (CC0 1.0) per USDA.
- **Integrity:** the snapshot carries a SHA-256 of its content; `import_starter.py --check` (run by `pnpm test`) verifies it and duplicate IDs.

## Test fixtures
`packages/nutrition/src/calculate.test.ts` uses synthetic round numbers labeled `TEST FIXTURE`; they are never loaded into the catalog.

## Not yet sourced
Retention and yield factors, cooking temperatures and safety guidance, Daily Values/DRIs, nutrient education, allergen and kosher information, food images. None are shown in the app until imported with sources.
