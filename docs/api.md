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
| GET/DELETE | `/v1/me` | yes | Account; delete account and all data |
| * | `/v1/auth/*` | — | Better Auth (email one-time code, sessions, sign-out) |
| * | `/v1/chef/*` | — | Always `404 feature_disabled` while the chef flag is off |
| GET | `/v1/dev/mailbox` | local/test only | Read sign-in codes; 404 in deployed environments |
