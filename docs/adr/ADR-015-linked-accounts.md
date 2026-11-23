# ADR-015: Linked accounts

**Status:** accepted (owner request, Gabriel, 2026-11-23: select the account he's using within his own login, act in a linked account, and let the connector manage it with his credentials; "everything can be opted in, a toggle for each", "the one handing over control should send the request", "also share groups … it should be something toggable", group sharing without notifying group admins, "drop the label", "keep it and build"). Plan: `/mnt/project-files/plans/linked-accounts-plan.md` (revision 5).

**Context:** People cook for a household. One person wants to plan, log and shop in a partner's account without sharing a password, and to let their AI app (Claude, ChatGPT through the connector) do the same.

**Options compared:**
- **A, shared password or a household account:** rejected. No record of who did what, no partial access, and a password leaves the person's control.
- **B, groups:** rejected for this. Groups share chosen meals and preferences with admins; they don't let one person work in another's whole kitchen.
- **C, delegated access with one toggle per area (chosen):** the owner shares areas of their account, each off, view or change; the other person acts in it with their own sign-in.

**Decision:** C.
- **Request:** only the owner sends it, to an email, with every area off by default. Nothing is shared until the person signed in with that verified email accepts. The answer and timing are the same whether or not the email has an account; an email goes only to an existing verified account. Requests lapse after 14 days; 5 a day and 10 live links each way. Sending and accepting need the current privacy notice.
- **Areas:** recipes, plans, eaten (meals and water logged, meal feedback), goals, preferences, shopping, children (everything for the owner's child profiles), milestones, groups, companion. `aiApps` (off by default) lets the other person's connected AI apps use what the areas allow (connector, PR C); it never adds access.
- **Acting:** the app sends `X-Act-As: <account id>`. `actingMiddleware` checks for an active link on every request, so changing or ending a link takes effect on the next request. `c.var.user` stays the signed-in person (rate limits, keys, reports); `requireUser(c)`, which every route uses, returns the owner after checking the route's policy.
- **Policy map:** `modules/linked/policy.ts` gives every OpenAPI route a decision: owner only, public, any link, an area at view or change (with an activity action), or custom (sync). Default deny: a missing route answers `403 owner_only`, and `test/linked.test.ts` fails when a route has no entry, so new routes, the cook features' included, get an explicit decision. Account, export, deletion, consent, linking itself (no chaining), publishing, share links, cook features, group membership and roles are owner only.
- **Narrowing inside a route:** routes spanning areas drop what isn't shared (meals: plans and eaten separately; preferences and feedback: the owner's versus children's; shopping: own, child or group; recipes: another member's group recipe needs groups). Sync applies each operation only if its areas allow change (rejected with `not_shared` or `view_only`) and filters the pull in SQL per area so paging stays correct.
- **Groups:** shared like any area. The other person acts in the owner's groups as the owner; group admins are not told and nothing is labelled, since the owner chose to trust them. The owner's activity log records it.
- **Companion and AI reads:** run on the signed-in person's own provider, key and daily limits, never the owner's; their keys and settings stay owner only.
- **Activity log:** `linked_activity` holds who acted (and their name, kept if their account is deleted), how (app or connector, the app's name), the action key and the record id, for every successful change and every change to a link. Written after the route succeeds (sync writes it in the operation's transaction); a failure to write is logged, not shown. Kept 12 months; both people see their entries; in the export.
- **Privacy notice:** version 2026-11-23 adds the general linked-accounts lines (owner choice "keep the general linked-accounts line").
- **Flag:** `FEATURE_LINKED_ACCOUNTS_ENABLED`, on outside production, off in production until the owner says.

**Consequences:** one choke point (`requireUser`) carries the rule, so most routes needed no change; the cost is that any route must read its account through it, which code review and the policy test check. Activity written after the response can, rarely, miss an entry if the database fails between the two. The web switcher (PR B) and the connector `account` parameter (PR C) build on this API.
