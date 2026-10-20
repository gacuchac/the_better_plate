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

- Exercised from real Claude and ChatGPT against the dev environment on 2026-10-20 (flag on in dev only). Each client's own setup steps (Claude: Settings → Connectors → Add custom connector; ChatGPT: developer mode connectors) may change and are not promised in the app copy.
- Registered client records stay after a person disconnects (they hold no personal data); approvals and tokens are deleted with the account.
- Rollback: turn the flag off. Migration `011` only adds tables.

## Addendum (2026-10-20): offered beside the companion, with live updates

The owner asked whether Claude or ChatGPT could sit in a floating panel inside the app. That isn't possible: both refuse to load inside another site's frame, and neither offers an embeddable chat for personal accounts. Owner decision: the in-app companion stays the promoted option, and "use your own Claude or ChatGPT" is offered as an alternative.

- **Where it's offered:** inside the companion panel ("Prefer your own Claude or ChatGPT? Use it instead") and under Connected apps. Both show the connector address with Copy, plus Open Claude / Open ChatGPT buttons. On wide screens the assistant opens in a window docked to the right of the app; elsewhere it opens a tab. The offer is hidden when the server has the connector switched off.
- **Live updates:** while the app is visible and the person has a connected assistant, it quietly pulls the sync feed every 5 seconds. A quiet pull doesn't touch the sync status chip and re-renders only when something changed. Local unsynced work goes through a normal sync first. There's no background polling when the tab is hidden or no assistant is connected.


## Addendum (2026-10-20): photos from the assistant, including ChatGPT-generated images

The owner asked for `upload_recipe_photo` to accept images ChatGPT generates, without assuming the server can open ChatGPT's sandbox paths or attachment ids.

**Inputs (exactly one):**
- `image`: a chat attachment as the client supplies it, `{ download_url, file_id, mime_type?, file_name? }`. The tool declares `_meta["openai/fileParams"] = ["image"]`, which tells ChatGPT to fill that field with an authorized, temporary download link. The server downloads it through the same SSRF-safe fetch as links (https on 443 only, every resolved address public, connection pinned, redirects re-checked, 9 MB cap). The `file_id` is only kept in the request; it is never used to call OpenAI.
- `imageUrl`: a public https link to the image file (unchanged).
- `imageBase64`: the file itself, plain or as a `data:` URL (unchanged, now strictly validated).

**Checks:** a declared type (attachment `mime_type`, `data:` type, HTTP `Content-Type`) must be JPEG, PNG, WebP or AVIF, or absent/`octet-stream`. The bytes decide: sharp must decode them as one of those four (AVIF is HEIF with AV1). The image is then re-encoded to WebP at most 1600 px with all metadata removed, stored owner-only in PostgreSQL, attached to the recipe, and read back. The tool answers only after that read-back succeeds (`verified: true`, image id, recipe version, stored size). No image URL is returned; images are served only to their owner's session. The app's own upload button also still takes phone formats like HEIC.

**Actionable errors:** sandbox paths and chat-only references (`/mnt/data/…`, `sandbox:`, `file:`, `chat_upload://…`, bare `file-…` ids) get "this is a file inside the chat app, which The Better Plate can't open", followed by the three ways that do work: attach the file to the chat, give a public link, or upload in the app. Invalid or cut-off base64, web pages instead of images, other formats, oversize files and failed downloads each get their own message.

**What each client can send (checked 2026-10-20):**
- **ChatGPT, files the person attaches (web):** passed through file params with a `download_url` and `file_id`. This is documented in the Apps SDK reference (developers.openai.com/plugins/reference, `_meta["openai/fileParams"]`). Verified by the owner against dev on 2026-10-20 with a JPEG attachment.
- **ChatGPT, images it generates:** **not supported by ChatGPT today.** Generated images live in ChatGPT's sandbox and reach tools as `/mnt/data/...` paths with no download link. OpenAI support confirmed on 2026-10-01 that such a path "isn't a URL that your remote MCP server can fetch directly", and gave no documented way to turn one into a `file_id` (community.openai.com thread 1382637). Base64 written out by the model is cut off for images around 2.5 MB (thread 1365335). **Workaround for people:** download the generated image and attach it to the chat, which makes it a file param, or upload it in the app.
- **ChatGPT mobile apps:** reported to send bare `chat_upload://image_0` strings instead of file objects (openai-apps-sdk-examples issue #185, still open as of 2026-09-19). These get the chat-only error.
- **Claude:** no file-param mechanism. Attached images are not handed to connector tools, and the model can't reproduce an image's bytes as base64. In practice Claude can send a public link, or base64 only when it has the bytes as text. This is inferred from the MCP specification having no file-input primitive yet; proposals SEP-2356 (base64 primitive) and SEP-2361 (file handling) are open.

When a client adds a file primitive (the MCP proposals above, or ChatGPT exposing generated images as file params), the `image` input is where it plugs in.
