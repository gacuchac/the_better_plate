# Release flags

| Flag | Default | Enforcement | Production rule |
|---|---|---|---|
| `FEATURE_CHEF_ENABLED` | `false` | `/v1/chef/*` returns `404 feature_disabled` server-side; API refuses to start in production with it `true` | Stays `false` until owner approval and release gates |
| `FEATURE_MCP_CONNECTOR_ENABLED` | `false` | `/mcp`, the OAuth discovery documents and every `/v1/auth/oauth2/*` route return 404 server-side; the app hides Connected apps when the server answers 404 | On in the cloud dev environment; production needs owner approval |
| `FEATURE_AI_COMPANION_ENABLED` | `false` | Every `/v1/ai/*` route returns `404 feature_disabled` server-side; the app hides the companion when the server says so; startup outside local/test requires `BYOK_ENCRYPTION_KEY` | On in the cloud dev environment; production needs owner approval |
| `FEATURE_COMMUNITY_RECIPES_ENABLED` | on outside production, `false` in production | Every `/v1/community/*` and `/v1/recipes/{id}/community` route returns `404 feature_disabled` server-side; the app hides sharing, trending and community picks when the server says so | Off in production until the owner releases it; the privacy notice covers it since version 2026-11-12 |
| `FEATURE_COMMUNITY_MILESTONES_ENABLED` | on outside production, `false` in production | Every `/v1/milestones*` route returns `404 feature_disabled` server-side; the app hides the milestone card and the cheers page when the server says so | Off in production until the owner releases it and approves the privacy notice wording |
| `FEATURE_GROUP_EMAIL_INVITES_ENABLED` | on outside production, `false` in production | Every `/v1/groups/{id}/pending*` and `/v1/me/group-invites*` route returns `404 feature_disabled` server-side; group detail reports `features.emailInvites` and the app hides Add by email and the invites list | Off in production until the owner releases it and approves the privacy notice wording (draft in `docs/drafts/privacy-notice-group-sharing.md`) |
| `FEATURE_GROUP_MEAL_SHARES_ENABLED` | on outside production, `false` in production | Every `/v1/groups/{id}/meal-shares*` route and `/v1/me/meals-to-review` return `404 feature_disabled` server-side; group detail reports `features.mealShares` and the app hides Shared meals | Off in production until the owner releases it and approves the privacy notice wording |

Client-side flags are never trusted; tests send forged client flags and expect the server to refuse (`apps/api/test/api.test.ts`, "keeps unreleased chef features off").
