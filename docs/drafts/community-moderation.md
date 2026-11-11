# Proposal: minimal moderation for community recipes

Status: **proposal for the owner's review.** What is listed under "Built" is in the PR; the rest is not built.

## Built

- **Opt-in only.** Nothing is shared unless the author reviews a preview and taps *Share with the community*. Group recipes can't be shared (their group owns them).
- **Owner can unshare at any time** from the recipe's page. Unsharing, deleting the recipe or deleting the account clears the snapshot.
- **Report button** on every community recipe that isn't yours. Reasons: not a recipe, offensive, unsafe, spam, other. One report per person per recipe; authors can't report their own.
- **Auto-hide at 3 reports** from different people (`HIDE_AFTER_REPORTS` in `apps/api/src/modules/community.ts`). Hidden recipes vanish from trending, the adventure pick and their page for everyone except the author, who sees a banner and can stop sharing.
- **No author identity anywhere**: the snapshot has no name or email, and the API never says who shared, saved or reported.
- **Server-side kill switch**: `FEATURE_COMMUNITY_RECIPES_ENABLED=false` makes every community route return 404 and the app hides the feature.

## Not built (next steps if needed)

1. **Owner review queue**: a small admin view of hidden and reported listings with *restore* and *remove*. Today, restoring a wrongly hidden recipe means clearing `hidden_at` in the database.
2. **Rate limit on sharing** (e.g. 10 new listings a day per person) to slow spam.
3. **Text checks before listing**: block links and obvious contact details in titles, descriptions and methods.
4. **Notify the author** when their recipe is hidden.

## Known gap

Three accounts can hide any recipe. With sign-in by email code that is cheap to abuse; the review queue (1) is the fix if it happens.
