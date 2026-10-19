# Data provenance

## Food composition: USDA FoodData Central, SR Legacy
- **What:** all 7,793 SR Legacy foods (owner decision, ADR-003). Snapshot `data/catalog/starter-catalog.json` (compact JSON, about 7 MB, about 0.6 MB gzipped), version `usda-sr-legacy-2026-10-19-df16ae75`, retrieved 2026-10-19T15:35:01Z. Report: `data/catalog/IMPORT_REPORT.md`.
- **How:** `scripts/usda/import_starter.py` lists every SR Legacy id with the official FDC `/foods/list` API, then fetches full records 20 at a time with `/foods` (about 430 calls). It refuses to write fewer than 7,000 foods. It runs in GitHub Actions (`.github/workflows/catalog-import.yml`) with the repository `USDA_API_KEY` secret, because cloud agent sessions cannot reach USDA hosts.
- **Kept per food:** FDC ID, description, category, NDB number, publication date, household portions with gram weights, 19 tracked nutrients per 100 g exactly as published, source URL `https://fdc.nal.usda.gov/food-details/<id>/nutrients`, retrieval timestamp.
- **Not reported ≠ zero:** nutrients USDA does not report are omitted, and the engine treats them as unknown. Reported zeros stay zero.
- **License:** FoodData Central data is public domain (CC0 1.0) per USDA.
- **Integrity:** the snapshot carries a SHA-256 of its content; `import_starter.py --check` (run by `pnpm test`) verifies it and duplicate IDs.

## Test fixtures
`packages/nutrition/src/calculate.test.ts` uses synthetic round numbers labeled `TEST FIXTURE`; they are never loaded into the catalog.

## Not yet sourced
Retention and yield factors, cooking temperatures and safety guidance, Daily Values/DRIs, nutrient education, allergen and kosher information, food images (except recipe photos the person chooses; see below). None are shown in the app until imported with sources.

## Recipe photos (ADR-006)

- **Openly licensed photos** come from Openverse search. Only `cc0`, `pdm`, `by` and `by-sa` are accepted; the server re-reads the license from Openverse by photo id when copying and stores title, creator, license (with version and URL), source page and provider. The credit is shown under the photo wherever it appears; the server overwrites any credit a client sends.
- **Generated images** are made with the person's own OpenAI key (newest available GPT image model) and stored with the provider and model; they are always labelled "AI-generated … not an exact depiction".
- The person chooses the photo (or the companion does, visibly and undoably); nothing checks automatically that a photo shows the right food, so the credit names the original title.
