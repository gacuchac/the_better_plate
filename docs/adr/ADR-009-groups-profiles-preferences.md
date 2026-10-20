# ADR-009: Groups, child profiles, food preferences and the shopping list

**Status:** accepted · **Date:** 2026-10-20 · **Decided by:** owner (scope, roles, profiles, allergy policy, PRODUCT.md change), agent (design)

## Context

The owner asked for families and nutritionists to plan meals for others, for the app to always ask about allergies and record likes, dislikes and post-meal comments, and for a weekly shopping list (store integration later). Owner decisions on 2026-10-20: children are parent-owned profiles with no login; no birthdates or ages; allergies are self-reported (we ask and record, we never diagnose); a curated allergen list from the FDA's nine; allergen conflicts alert and never block; nutritionists are admins with full access to what members ate and said; people can be in several groups; shopping lists per person and per group; PRODUCT.md may change (now §2.12).

## Decisions

1. **One kitchen per account, profiles inside it.** Plans, eaten logs, preferences and feedback for a profile live in the parent's change feed with `profile_id` set. The person's own totals, goals, Meals view and connector tools exclude profiles (`profile_id is null`). No new sync stream was needed.
2. **Group plans are written into the member's kitchen.** `planned_meals.group_id`, `author_user_id` and `status` (`planned | proposed | declined`). A plan with a group is managed: the member's own writes are rejected (`managed_by_group`); admins change it with `If-Match` (412 returns the server copy). A plain member's own plans start `proposed` and are excluded from the shopping list until an admin approves.
3. **Group recipes are ordinary recipes with `group_id`.** Readable by every member (`READABLE_RECIPES`), editable by owner and admins through the normal recipe API and sync; members get `403 read_only`. Copying into a group bumps the sequence for every member's feed; joiners get them re-sent after their cursor. Devices drop copies from groups they are no longer in after checking `GET /v1/groups`.
4. **Locking.** Writes visible in several feeds take every affected account's advisory lock in sorted order, so each feed stays in commit order without deadlocks.
5. **Roles.** One owner (only they remove others, change roles, invite admins, end the group; they cannot leave or be removed), admins (plan, invite members, add child profiles, record a profile's preferences, see everything), members. Invite links are single use, 7 days, revocable; limits: 20 groups per person, 50 members, 20 open invites.
6. **Preferences and allergens.** `food_preferences` keyed by the person (account id or profile id) with `allergy_answer` (`listed | none | prefer_not`); `meal_feedback` keyed by the eaten log and removed with it. Allergen tags come from versioned name rules (`allergen-rules-1`, docs/data-provenance.md); alerts list matches and a "may contain others" note, and are returned with group plans but never block.
7. **Shopping list in the shared engine.** `buildShoppingList` sums recipe grams scaled to servings planned, counts oil as added, flags cooked-form foods and missing recipes. The device computes a person's or profile's list offline; `GET /v1/shopping-list` gives the same result, plus whole-group lists for admins.

## Alternatives considered

- Child accounts with logins: rejected by the owner (no ages; children don't need credentials).
- A separate group feed: rejected; writing into each kitchen keeps offline Meals working with no new sync protocol.
- Blocking plans that conflict with an allergy: rejected by the owner (alert only).
- Inferring allergens from ingredient lists or labels: not available in SR Legacy; names only, stated as such.

## Consequences

- Data collection expands (privacy data map rows for preferences, feedback, profiles, groups); approved by the owner. Counsel review of health-data and children's-data questions is recorded as risk R-groups before public launch.
- IndexedDB schema version 4 adds `prefs`, `feedback` and `profiles` stores. Feedback shares its id with the eaten log, so the outbox coalesces by operation type.
- Group screens are online; what they plan reaches members' kitchens through sync and works offline there.
- Not built yet: owner transfer, renaming a profile in the app (API exists), Instacart or other store export.
