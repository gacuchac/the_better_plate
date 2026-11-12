# Draft: privacy notice change for community recipes

Status: **approved by the owner 2026-11-12** and published as notice version `2026-11-12` in `packages/contracts/src/privacy.ts` (people are asked to agree again).
AGENTS.md requires explicit owner approval for any change to privacy or data-collection scope.

## Why it changes

Community recipes (migration `018_favorites_community.sql`) add three things people can do:
share a recipe with everyone signed in, save a copy of someone else's shared recipe, and report one.
Favorites are also new, but they are only the person's own list, like plans.

## Proposed wording

Bump `version` to the approval date (people are asked to agree again) and change two sections.

**What we keep in your account** — append:

> Recipes you mark as favorites. Recipes you share with the community, copies you save from it and reports you send about it.

**Sharing** — replace with:

> A share link shows only what you reviewed before creating it: the recipe, its amounts and the estimate, and your method if you choose.
> Anyone with the link can read it until you revoke it or it expires.
>
> You can also share a recipe with the community. Everyone signed in to The Better Plate can then read the version you reviewed and save a copy to their own kitchen.
> Copies people already saved stay with them if you stop sharing. Popular recipes are picked by how many different people saved them; nobody sees who saved or reported a recipe.
>
> Neither a share link nor a community recipe ever shows your name, email or meals.

**Your choices** — change "revoke share links" to "revoke share links, stop sharing community recipes".

## Points to decide

1. Saved copies outlive unsharing. That matches share links today ("Save a copy" already exists there). The alternative is deleting copies on unshare, which takes recipes out of other people's kitchens.
2. Reports keep the reporter's account id, so one person counts once. It is deleted with their account.
3. The "Up for an adventure?" pick compares community recipes with the person's own eaten meals from the last 30 days. That reads data we already keep, on the server, for that person only; nothing new is stored. Worth one sentence in the notice if you prefer it spelled out.
4. Production stays off (`FEATURE_COMMUNITY_RECIPES_ENABLED` defaults to off there) until this wording is approved. **Dev and local default to on**, so testers on the dev site will see sharing before they agree to wording that mentions it. Set the flag to `false` on dev if that matters before approval.
