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
| Issue reports: message, chosen recent steps, route, app version, device class, request ids, sanitized error, optional screenshot the person previewed | `feedback_reports` | Fixing problems | Deleted with the account; retention policy for anonymous reports not set yet |
| Share links: snapshot of the recipe title, servings, ingredients (USDA names and amounts), estimate and, only if ticked, the method; created and expiry times | `share_snapshots` | Revocable public links | Readable by anyone with the link until revoked, expired, the recipe is deleted or the account is deleted; revoking erases the snapshot. Never includes name, email, meals or other recipes |
| Sync operation ledger | `sync_operations` | Idempotency | 30 days (daily maintenance job), or account deletion |
| Privacy notice agreements (notice version, adult confirmation, time) | `consent_events` | Record of consent | Until account deletion; included in the data export |
| Recipes, plans, eaten logs, outbox, sync cursor | Browser IndexedDB `betterplate-user-<id>` | Offline use | Deleted on sign-out or when another account signs in |
| Last account id and email | Browser `localStorage` `bp.account` | Open offline | Removed on sign-out |
| Issue reports waiting to send (at most 5) | Browser `localStorage` `bp.feedback.queue` | Offline report queue | Removed once sent |
| Recent readable steps and last error message | Browser memory only | Prefill issue reports | Gone when the tab closes |
| USDA catalog | Browser IndexedDB `betterplate-catalog` | Offline foods | Public data; kept |
| Access logs | API stdout | Operations | Method, route pattern, status, duration, request id only; no bodies, cookies or query values |

Not collected: phone, address, date of birth, demographics, clinical data, payment data. The privacy notice (`packages/contracts/src/privacy.ts`) is a versioned draft that has not had legal review (preflight P3). No analytics or session replay.
