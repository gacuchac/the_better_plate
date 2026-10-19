# Release flags

| Flag | Default | Enforcement | Production rule |
|---|---|---|---|
| `FEATURE_CHEF_ENABLED` | `false` | `/v1/chef/*` returns `404 feature_disabled` server-side; API refuses to start in production with it `true` | Stays `false` until owner approval and release gates |
| `FEATURE_AI_COMPANION_ENABLED` | `false` | No AI routes exist yet | Off until the BYOK milestone ships |

Client-side flags are never trusted; tests send forged client flags and expect the server to refuse (`apps/api/test/api.test.ts`, "keeps unreleased chef features off").
