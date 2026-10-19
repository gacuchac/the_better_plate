# Privacy data map (M1)

| Data | Where | Why | Retention / deletion |
|---|---|---|---|
| Email, optional name (empty by default), email-verified flag | `users` | Account and sign-in | Until account deletion (`DELETE /v1/me` cascades) |
| Session token, IP address, user agent | `sessions` | Session security (Better Auth default fields) | Expires after 30 days; deleted on sign-out or account deletion |
| Google account id and encrypted Google tokens (only for Google sign-in); name from the Google profile | `accounts`, `users.name` | Sign-in with Google | Until account deletion; profile photo is not stored |
| Hashed sign-in code | `verifications` | Email verification | Expires after 10 minutes |
| Recipes and immutable revisions | `recipes`, `recipe_revisions` | The product | Until the user deletes the recipe (content cleared to a tombstone) or the account |
| Sync operation ledger | `sync_operations` | Idempotency | Until account deletion (pruning job not-started) |
| Recipes, outbox, sync cursor | Browser IndexedDB `betterplate-user-<id>` | Offline use | Deleted on sign-out or when another account signs in |
| Last account id and email | Browser `localStorage` `bp.account` | Open offline | Removed on sign-out |
| USDA catalog | Browser IndexedDB `betterplate-catalog` | Offline foods | Public data; kept |
| Access logs | API stdout | Operations | Method, route pattern, status, duration, request id only; no bodies, cookies or query values |

Not collected: phone, address, date of birth, demographics, clinical data, payment data. Privacy notice and consent versioning are not built yet (preflight P3). No analytics or session replay.
