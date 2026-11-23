# Privacy notice change for linked accounts

Status: **published as notice version `2026-11-23`** in `packages/contracts/src/privacy.ts`, on the owner's choice in the linked-accounts plan (2026-11-23: "keep the general linked-accounts line", then "keep it and build"). The owner can change the wording before production; the flag `FEATURE_LINKED_ACCOUNTS_ENABLED` stays off there until released.
AGENTS.md requires explicit owner approval for any change to privacy or data-collection scope.

## Why it changes

Linked accounts (ADR-015, migration `025_linked_accounts.sql`) keep the email a request was sent to, what each link shares, and a 12-month log of what was done through it. Someone the owner trusts can act in their groups as them.

## Added lines

- What we keep: "If you link accounts with someone: the email you shared yours with, what you chose to share, and a log of what was done through the link, kept 12 months."
- Sharing: "You can let someone you trust use parts of your account with their own sign-in, such as your recipes, plans or groups, each turned on separately, to view or to change. Nothing is shared until they accept, and they can let their AI apps use it only if you allow that too. If you share your groups, they act in them as you, and the group sees it as you; your activity log shows what they did."
- Your choices: "change or end what you share with a linked account".
