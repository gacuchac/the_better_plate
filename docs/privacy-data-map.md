# Privacy data map

| Data | Where | Why | Retention / deletion |
|---|---|---|---|
| Email, optional name (empty by default), email-verified flag | `users` | Account and sign-in | Until account deletion (`DELETE /v1/me` cascades) |
| Session token, IP address, user agent | `sessions` | Session security (Better Auth default fields) | Expires after 30 days; deleted on sign-out, by the daily maintenance job once expired, or on account deletion |
| Google account id and encrypted Google tokens (only for Google sign-in); name from the Google profile | `accounts`, `users.name` | Sign-in with Google | Until account deletion; profile photo is not stored |
| Hashed sign-in code | `verifications` | Email verification | Expires after 10 minutes |
| Recipes and immutable revisions | `recipes`, `recipe_revisions` | The product | Until the user deletes the recipe (content cleared to a tombstone) or the account |
| Planned meals (day, meal slot, recipe id and title, servings) | `planned_meals` | Meal planning | Until the user removes the plan (content cleared to a tombstone) or the account |
| Eaten meals (recipe snapshot, servings, meal slot, local day, time eaten with offset, nutrition snapshot) | `consumption_events` | Explicitly logged meals | Until the user removes the log (content cleared to a tombstone) or the account |
| Consumption goals: nutrient, at least / at most / between amounts the person typed, day / week / month, start and optional end date. Nothing about body, weight or health | `goals` | Goals the person sets on what they eat (owner decision 2026-10-20: stored on the server and synced) | Until the person deletes the goal (tombstone kept for sync) or the account; included in the export |
| Issue reports: message, chosen recent steps, route, app version, device class, request ids, sanitized error, optional screenshot the person previewed | `feedback_reports` | Fixing problems | Deleted with the account; retention policy for anonymous reports not set yet |
| Share links: snapshot of the recipe title, description, servings, ingredients (USDA names and amounts), estimate and, only if ticked, the method; created and expiry times | `share_snapshots` | Revocable public links | Readable by anyone with the link until revoked, expired, the recipe is deleted or the account is deleted; revoking erases the snapshot. Never includes name, email, meals or other recipes |
| AI provider keys (encrypted with AES-256-GCM, last four characters in clear), chosen model, active provider, daily limit | `ai_credentials`, `ai_settings` | Optional AI companion on the person's own key | Until the person disconnects the provider or deletes the account; keys are never exported, logged or sent to the browser |
| AI usage: requests and tokens per day | `ai_usage` | Daily limit and cost visibility | Until account deletion; included in the export |
| Included-companion usage: requests and tokens per day and model | `ai_house_usage` | Per-person daily cap and the owner's monthly spend cap | Included in the export; on account deletion the counters stay without the account link (no content) so the monthly total can't be reset |
| Included-companion messages, and the recipe and meal details the companion reads | Sent to OpenAI under The Better Plate's account (not stored by us) | Answering the person when they use the included companion | Disclosed in AI settings; OpenAI's API data terms apply |
| Companion messages and what its tools read (recipes, foods, meals, period totals, goals) | Sent to the provider the person chose, under their own key and that provider's terms; kept only in the open tab's memory | Optional AI companion | Not stored by The Better Plate; gone when the tab closes, on New chat or sign-out |
| Recipe images: image bytes, license credit (photos), provider and model (generated), or for the person's own uploads the time they confirmed they may use it and whether it came from the app or a connected assistant (uploads are re-encoded with all metadata, including location, removed) | `recipe_images` | Photos on the person's recipes | Until account deletion; images no live recipe uses are deleted after 7 days by the daily job; included in the export |
| Recipe images cached for offline | Service worker cache `recipe-images` | Show photos offline | Deleted on sign-out or account switch |
| Photo search descriptions and previews | Sent to Openverse (search text by our server; previews load from Openverse in the browser, no referrer) | Finding openly licensed photos | Not stored by The Better Plate |
| Connected assistants: the assistant's self-registered name and return address, the permissions the person approved, when | `oauthClient`, `oauthConsent` | Claude/ChatGPT connector (ADR-007) | Until the person disconnects it under AI companion or deletes the account; listed in the export |
| Connector tokens: short-lived signed access tokens (15 minutes, not stored), hashed refresh tokens and authorization codes | `oauthRefreshToken`, `oauthAccessToken`, `verifications`, signing keys in `jwks` | Letting a connected assistant act for the person | Disconnecting stops every token at once (each call checks the approval); deleted with the account; tokens are never exported or logged |
| What a connected assistant reads or writes through its tools (recipes, foods, plans, eaten meals, period totals, goals) | Sent to the assistant's provider (Anthropic, OpenAI…) under the person's own account there | Connector | Not stored by The Better Plate beyond the normal recipe and meal records the person approved changes to |
| Sync operation ledger | `sync_operations` | Idempotency | 30 days (daily maintenance job), or account deletion |
| Privacy notice agreements (notice version, adult confirmation, time) | `consent_events` | Record of consent | Until account deletion; included in the data export |
| Recipes, plans, eaten logs, goals, outbox, sync cursor | Browser IndexedDB `betterplate-user-<id>` | Offline use | Deleted on sign-out or when another account signs in |
| Last account id and email | Browser `localStorage` `bp.account` | Open offline | Removed on sign-out |
| Issue reports waiting to send (at most 5) | Browser `localStorage` `bp.feedback.queue` | Offline report queue | Removed once sent |
| Recent readable steps and last error message | Browser memory only | Prefill issue reports | Gone when the tab closes |
| USDA catalog | Browser IndexedDB `betterplate-catalog` | Offline foods | Public data; kept |
| Access logs | API stdout | Operations | Method, route pattern, status, duration, request id only; no bodies, cookies or query values |

Not collected: phone, address, date of birth, demographics, clinical data, payment data. The privacy notice (`packages/contracts/src/privacy.ts`) is a versioned draft that has not had legal review (preflight P3). No analytics or session replay.
