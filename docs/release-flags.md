# Release flags

| Flag | Default | Enforcement | Production rule |
|---|---|---|---|
| `FEATURE_CHEF_ENABLED` | `false` | `/v1/chef/*` returns `404 feature_disabled` server-side; API refuses to start in production with it `true` | Stays `false` until owner approval and release gates |
| `FEATURE_AI_COMPANION_ENABLED` | `false` | Every `/v1/ai/*` route returns `404 feature_disabled` server-side; the app hides the companion when the server says so; startup outside local/test requires `BYOK_ENCRYPTION_KEY` | On in the cloud dev environment; production needs owner approval |

Client-side flags are never trusted; tests send forged client flags and expect the server to refuse (`apps/api/test/api.test.ts`, "keeps unreleased chef features off").
