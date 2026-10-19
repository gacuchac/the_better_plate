# ADR-006: Recipe photos (openly licensed or generated on your key)

**Status:** accepted · **Date:** 2026-10-19 · **Decided by:** owner (images "searched from publicly available for public use or generated through byok"; find them "by descriptions") and agent (implementation)

## Decisions

1. **Search by description through Openverse.** One source that already aggregates Wikimedia Commons, Flickr and others, with license filtering. The person (or the companion) types a plain description; the server tries the full text, then each main word, and ranks results by how many description words a photo's title and tags mention.
2. **Licenses:** public domain mark, CC0, CC BY and CC BY-SA only. Non-commercial and no-derivatives licenses are never offered.
3. **Copied, not hot-linked.** Choosing a photo makes the server look it up again by Openverse id, re-check the license, and download Openverse's resized copy from `api.openverse.org` only (no client-supplied URLs, so no SSRF). Stored in PostgreSQL (`recipe_images`, ≤3 MB each, 100 per person) and served only to its owner, so recipes keep their photo if the source disappears and photos work offline (service worker cache, cleared on sign-out). Search previews do load from Openverse in the browser, without a referrer, and the sheet says so.
4. **Generated images** use the person's OpenAI key (`gpt-image-2`, falling back to older GPT image models the key can use), medium quality, 1536×1024 WebP, and are labelled AI-generated with the model name. Anthropic has no image generation, so this needs OpenAI connected.
5. **Credit integrity:** the recipe stores `{id, alt, kind, credit, generator}`; on save the server replaces kind/credit/generator with its own record and drops an image id that isn't the person's (dropping, not rejecting, so an offline device's recipe still syncs).
6. **Clean-up:** images no live recipe uses are deleted after 7 days by the daily maintenance job.

## Consequences

- Shared links don't show photos yet (owner-only serving); public share images remain a follow-up.
- Not verified against the live Openverse or OpenAI image APIs from automated tests; local runs use `scripts/mock-openverse.mjs` with labeled flat-colour fixture images.
