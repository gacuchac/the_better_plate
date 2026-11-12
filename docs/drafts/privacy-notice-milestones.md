# Draft: privacy notice change for shared milestones

Status: **draft for the owner's approval. Not published.** `packages/contracts/src/privacy.ts` is unchanged.
AGENTS.md requires explicit owner approval for any change to privacy or data-collection scope.

## Why it changes

Shared milestones (migration `019_milestones.sql`) add two things people can do: share a milestone the
app suggests (one of five fixed kinds, the week, and for "tried something new" one catalog food), and
cheer someone else's milestone with one of three preset reactions. There is no free text.

Suggestions are worked out on the person's own device from meals they already logged. The server only
adds which of their recipes are community copies or were created in the last 8 days, from data it
already keeps. Nothing new is stored until the person taps Share.

## Proposed wording

Bump `version` to the approval date (people are asked to agree again) and change three sections.

**What we keep in your account**: append

> Milestones you choose to share and cheers you give.

**Sharing**: insert before the last sentence

> You can also share a milestone the app suggests, like trying a new vegetable. Everyone signed in sees only the milestone's words, never your name, email, meals or amounts, and can cheer it with a preset reaction. Only you see how many cheers you got, and nobody sees who cheered.

**Your choices**: change "stop sharing community recipes" to "stop sharing community recipes and milestones".

## Points to decide

1. Cheers keep the cheering person's account id, so one person counts once and can change or take back a cheer. It is deleted with their account and is in their data export.
2. A shared milestone stays in others' cheers page for 14 days, then stays visible only to its author until they stop sharing it.
3. Production stays off (`FEATURE_COMMUNITY_MILESTONES_ENABLED` defaults to off there) until this wording is approved. **Dev and local default to on**, so testers on the dev site can share milestones before agreeing to wording that mentions them. Set the flag to `false` on dev if that matters before approval.
