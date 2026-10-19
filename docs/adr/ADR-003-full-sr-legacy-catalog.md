# ADR-003: Ship all of USDA SR Legacy on the device

**Status:** accepted (2026-10-19, owner decision in the project thread).

## Context
The pilot shipped 149 hand-picked SR Legacy foods (PRODUCT.md §2.2 suggests 100–200 to start). Testing showed obvious gaps, such as no steak cuts. USDA data is public domain.

## Options
1. Grow the hand-picked list. This is slow, and every gap waits on a list edit.
2. **Use all of SR Legacy (about 7,800 foods) on the server and on the device.** It covers common cuts, cooked and raw states, and portions.
3. Add Foundation Foods, which is newer and has detailed lab data. Deferred because it is smaller, overlaps SR Legacy and has different portion conventions.
4. Add Branded Foods (about 400,000 label-based products). Rejected for the device because of size and varying quality. It is a candidate for online-only search later.

## Decision
Option 2. The importer lists every SR Legacy id with `/foods/list` and fetches full records 20 at a time with `/foods`. That is about 430 calls, within a free key's hourly limit. It runs in GitHub Actions and refuses to write fewer than 7,000 foods. The snapshot is compact JSON. The bundle is gzip-compressed and cached in memory per version. The seed inserts in batches of 500.

Search moved to one shared, deterministic function (`packages/nutrition/src/search.ts`) used both offline and by `GET /v1/foods`:
- Query words match whole words, word starts or word parts, in any order.
- Simple plurals match.
- Results are ranked by match quality, then the main food name, then raw entries, then shorter names.

## Consequences
- The first-run download grows from about 0.2 MB to a few MB compressed. It is cached afterwards (ETag) and works offline.
- Search covers the main gap. USDA's wording still differs from everyday names (for example "rib eye" vs "ribeye"), and an alias table is a possible follow-up.
- Food ids (`fdc:<id>`) are unchanged, so existing recipes keep working.
