# API

The contract is [`apps/api/openapi.json`](../apps/api/openapi.json) (OpenAPI 3.1, generated from the route definitions; a test fails when it drifts). A running API also serves it at `GET /v1/openapi.json`.

## Conventions
- Base path `/v1`. JSON only; mutations must send `Content-Type: application/json`.
- Errors: `{"error": {"code", "message", "requestId", "details?"}}` with the same id in the `X-Request-Id` header.
- Auth: session cookie from Better Auth. Browser clients send `credentials: "include"`.
- Recipe writes use optimistic concurrency: `ETag: "v<version>"` and `If-Match` (412 with the server copy on mismatch, 428 when missing).
- Nutrition is always recomputed on the server from catalog records; client values are previews.

## Sign in (local example with curl)
```bash
API=http://localhost:4000; EMAIL=me@example.test
curl -s -X POST $API/v1/auth/email-otp/send-verification-otp -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}"
CODE=$(curl -s "$API/v1/dev/mailbox?email=$EMAIL" | python3 -c 'import sys,json,re;print(re.search(r"\d{6}",json.load(sys.stdin)["messages"][0]["subject"]).group())')
curl -s -c jar -X POST $API/v1/auth/sign-in/email-otp -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"otp\":\"$CODE\"}" >/dev/null
curl -s -b jar $API/v1/me
```

## Operations
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/health/live`, `/v1/health/ready` | no | Liveness; database + catalog readiness |
| GET | `/v1/catalog/manifest` | no | Current catalog version, nutrient definitions, bundle URL |
| GET | `/v1/catalog/bundle` | no | Whole starter catalog for offline use (ETag) |
| GET | `/v1/foods?query=&limit=&cursor=` | no | Search the catalog |
| GET | `/v1/foods/{foodId}` | no | One food (`fdc:<id>`) with per-100 g values and source |
| POST | `/v1/foods/batch` | no | Up to 100 ids; returns found foods and missing ids |
| GET/POST | `/v1/recipes` | yes | List mine; create (client may send its local UUID) |
| GET/PUT/DELETE | `/v1/recipes/{id}` | yes | Read; replace or delete with `If-Match` |
| POST | `/v1/recipes/calculate` | yes | Nutrition preview without saving |
| POST | `/v1/sync/batch` | yes | Protocol 1: ≤100 ops, per-op `applied` / `conflict` / `rejected` / `retry`, idempotent by `opId` |
| GET | `/v1/sync/changes?cursor=` | yes | Changes after cursor in commit order, with tombstones |
| GET | `/v1/goals` | yes | My consumption goals (written with sync ops `goal.put` / `goal.delete`) |
| GET | `/v1/nutrition/summary?from=&to=` | yes | Estimated totals and per-logged-day averages of eaten meals over 1–366 days; plans never count |
| GET | `/v1/preferences`, `/v1/meal-feedback` | yes | My kitchen's food preferences (mine and my profiles') and meal feedback; written with sync ops `prefs.put` (entity = my id or a profile id) and `feedback.put` (entity = eaten log id) |
| GET | `/v1/shopping-list?from=&to=[&profileId=|&groupId=]` | yes | What to buy for planned meals over ≤31 days; a group's for its owner and admins |
| GET/POST | `/v1/groups` | yes | My groups; start one (I become owner) |
| GET/PUT/DELETE | `/v1/groups/{id}` | member / owner | Members and (admins) open invites; rename; end the group |
| POST/DELETE | `/v1/groups/{id}/invites[/{inviteId}]` | admin (admin invites: owner) | Single-use invite links, 7 days |
| GET, POST | `/v1/invites/{token}`, `/v1/invites/{token}/accept` | yes | Preview an invite; join with a display name |
| PUT/DELETE | `/v1/groups/{id}/members/{memberId}` | owner / self | Change role; remove or leave |
| POST | `/v1/groups/{id}/profiles`, `/v1/groups/{id}/members` | admin / profile owner | Add a child profile; add an existing profile to another group |
| GET, PUT/DELETE | `/v1/profiles`, `/v1/profiles/{id}` | owner | My profiles; rename; delete with everything recorded |
| PUT | `/v1/groups/{id}/members/{memberId}/preferences` | admin | Record a profile's allergies, likes and dislikes |
| GET | `/v1/groups/{id}/meals?from=&to=` | admin | Every member's plans, eaten meals, feedback and preferences |
| POST, PUT/DELETE | `/v1/groups/{id}/plans[/{planId}]` | admin | Plan a group recipe for a member (returns an allergen alert, never blocks); change/remove with `If-Match` |
| POST | `/v1/groups/{id}/plans/{planId}/approve`, `/decline` | admin | Decide on a meal a member planned for themselves |
| GET/POST | `/v1/groups/{id}/recipes` | member / admin | Group recipes; copy one of mine into the group (admins edit it via `PUT /v1/recipes/{id}` or sync) |
| GET/DELETE | `/v1/me` | yes | Account; delete account and all data |
| * | `/v1/auth/*` | — | Better Auth (email one-time code, sessions, sign-out) |
| * | `/v1/chef/*` | — | Always `404 feature_disabled` while the chef flag is off |
| GET | `/v1/dev/mailbox` | local/test only | Read sign-in codes; 404 in deployed environments |
