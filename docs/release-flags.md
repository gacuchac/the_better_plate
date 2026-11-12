# Release flags

| Flag | Default | Enforcement | Production rule |
|---|---|---|---|
| `FEATURE_CHEF_ENABLED` | `false` | `/v1/chef/*` returns `404 feature_disabled` server-side; API refuses to start in production with it `true` | Stays `false` until owner approval and release gates |
| `FEATURE_MCP_CONNECTOR_ENABLED` | `false` | `/mcp`, the OAuth discovery documents and every `/v1/auth/oauth2/*` route return 404 server-side; the app hides Connected apps when the server answers 404 | On in the cloud dev environment; production needs owner approval |
| `FEATURE_AI_COMPANION_ENABLED` | `false` | Every `/v1/ai/*` route returns `404 feature_disabled` server-side; the app hides the companion when the server says so; startup outside local/test requires `BYOK_ENCRYPTION_KEY` | On in the cloud dev environment; production needs owner approval |
| `FEATURE_COMMUNITY_RECIPES_ENABLED` | on outside production, `false` in production | Every `/v1/community/*` and `/v1/recipes/{id}/community` route returns `404 feature_disabled` server-side; the app hides sharing, trending and community picks when the server says so | Off in production until the owner releases it; the privacy notice covers it since version 2026-11-12 |
| `FEATURE_COMMUNITY_MILESTONES_ENABLED` | on outside production, `false` in production | Every `/v1/milestones*` route returns `404 feature_disabled` server-side; the app hides the milestone card and the cheers page when the server says so | Off in production until the owner releases it and approves the privacy notice wording |

Client-side flags are never trusted; tests send forged client flags and expect the server to refuse (`apps/api/test/api.test.ts`, "keeps unreleased chef features off").
