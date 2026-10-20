# ADR-007: Claude/ChatGPT connector (MCP with OAuth)

**Status:** accepted · **Date:** 2026-10-19 · **Decided by:** owner ("can the user connect with their personal chat gpt or claude account?" → "yes and continue with the plan") and agent (implementation)

## Context

People asked to use the assistant they already pay for instead of an API key. Claude and ChatGPT cannot be signed into from a third-party app, but both can add remote **MCP connectors** that sign in to the third party with OAuth. So the direction is reversed: the person adds The Better Plate to Claude or ChatGPT, and their assistant works in their kitchen with their own subscription. No model runs on our side and we pay nothing per message.

## Decisions

1. **Authorization server:** Better Auth's `@better-auth/oauth-provider` plugin (same library as sign-in, ADR-002) with its `jwt` plugin for signing. Issuer `<PUBLIC_API_URL>/v1/auth`. OAuth 2.1 with PKCE (S256), unauthenticated **dynamic client registration** (Claude and ChatGPT register themselves), resource indicators bound to `<PUBLIC_API_URL>/mcp`. Tables come from the plugin's own schema, frozen in migration `011`.
2. **Permissions:** `kitchen:read` and `kitchen:write`, plus `offline_access` for refresh tokens. Access tokens are signed JWTs valid 15 minutes, verified locally against the server's JWKS. Every MCP call also checks that the person's approval for that client still exists, so **Disconnect works immediately**, not after the token expires.
3. **Consent in the app:** the authorize endpoint sends people to `#/connect/login` (sign in first) or `#/connect` (approve). The screen names the assistant, shows the host it returns to (registration is open, so a client can call itself anything; the host is what can't be faked), lists the permissions in plain words and says what it can't reach. Nothing is granted without Allow.
4. **MCP endpoint:** `/mcp`, Streamable HTTP, stateless (a fresh server per request, JSON responses), discovery at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/v1/auth`. A 401 carries `WWW-Authenticate` with the resource metadata URL, as the MCP authorization spec requires. Rate limited per person.
5. **Tools:** 12 tools with the companion's validated input schemas: search foods, get food, list/get/save/delete recipe, plan meal, log meal, get day, remove eaten meal, find photos, set recipe photo. They call the same services as the app and sync (server-side nutrition, catalog ids only, no future eaten logs, ownership checks), so a connected assistant can't do anything the app wouldn't. Deletes carry `destructiveHint` so the assistant asks first. Changes reach the person's devices through the normal sync feed.
6. **Flag:** `FEATURE_MCP_CONNECTOR_ENABLED`, off by default; off means 404 for `/mcp`, discovery and all `/v1/auth/oauth2/*` routes.

## Alternatives considered

- **"Sign in with ChatGPT/Claude" to use their subscription inside our app:** not offered to general developers (ChatGPT sign-in is partner-only; using Claude subscriptions in third-party apps is against Anthropic's terms). Revisit if that changes.
- **Our own OAuth server:** more code to get wrong; Better Auth already holds sessions and users.
- **Opaque tokens with introspection:** an extra query per call for no gain once each call checks the approval anyway.

## Consequences

- Not yet exercised from real Claude or ChatGPT; both need the public HTTPS dev URL with the flag on. Each client's own setup steps (Claude: Settings → Connectors → Add custom connector; ChatGPT: developer mode connectors) may change and are not promised in the app copy.
- Registered client records stay after a person disconnects (they hold no personal data); approvals and tokens are deleted with the account.
- Rollback: turn the flag off. Migration `011` only adds tables.

## Addendum (2026-10-20): offered beside the companion, with live updates

The owner asked whether Claude or ChatGPT could sit in a floating panel inside the app. That isn't possible: both refuse to load inside another site's frame, and neither offers an embeddable chat for personal accounts. Owner decision: the in-app companion stays the promoted option, and "use your own Claude or ChatGPT" is offered as an alternative.

- **Where it's offered:** inside the companion panel ("Prefer your own Claude or ChatGPT? Use it instead") and under Connected apps. Both show the connector address with Copy, plus Open Claude / Open ChatGPT buttons. On wide screens the assistant opens in a window docked to the right of the app; elsewhere it opens a tab. The offer is hidden when the server has the connector switched off.
- **Live updates:** while the app is visible and the person has a connected assistant, it quietly pulls the sync feed every 5 seconds. A quiet pull doesn't touch the sync status chip and re-renders only when something changed. Local unsynced work goes through a normal sync first. There's no background polling when the tab is hidden or no assistant is connected.

