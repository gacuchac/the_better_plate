# Draft: privacy notice change for cooking for others

Status: **approved by the owner on 2026-11-22** and published as notice version `2026-11-22` in `packages/contracts/src/privacy.ts`. Points 1 to 3 below kept the draft's defaults: no extra warning on notes, receipt photos kept until the cook deletes them, admins see preferences by name as today. Production flags stay off until turned on separately.
AGENTS.md requires explicit owner approval for any change to privacy or data-collection scope.

## Why it changes

Cooking for others (migration `024_cook_profile.sql`, flag `FEATURE_COOK_PROFILE_ENABLED`) adds data
the current notice doesn't cover:

- A cook keeps **records about other people**: clients' names and the cook's own notes, which can
  include allergies. Those people may not use the app at all.
- **Grocery receipt photos are kept** (re-encoded, metadata dropped) for the cook, unlike recipe
  photos, which are never stored. Each photo goes once to the AI provider (the cook's own key or the
  included companion) to be read.
- A cook sees **food preferences of the people they cook for**: their own, every member of a group
  they run, one member of a group they run, a linked client; and in a group where they are a plain
  member, the group's allergens combined without names. Never meals eaten or goals.
- A **linked client** sees every meal cooked for them (name and date) and only the parts the cook
  shares; prices stay hidden unless shared.
- Shares can be **links anyone can open**, with only the parts the cook switched on.

## Proposed wording

Bump `version` to the approval date (people are asked to agree again) and change four sections.

**What we keep in your account**: append

> If you cook for others: your cooking profile, the people you cook for and your notes about them, the meals you cook with their recipes, time and costs, grocery receipts with their photos, your ingredient prices and your statements. Only you see your notes and receipt photos. If a cook invites you by email, we keep that email for up to 30 days and send you one email about it.

**What we don't collect**: change "No phone number, address, date of birth, health history or payment details." to

> No phone number, address, date of birth, health history or payment details. Lines on a grocery receipt about how it was paid are left out, and the app takes no payments.

**Sharing**: append

> If someone cooks for you in the app, they see your food preferences, never your meals or goals. A cook in your group sees the group's allergies; only the group's owner and admins see them by name. When you accept a cook's invite, you see every meal they cooked for you and whatever they choose to share, and they see your food preferences. A cook can also share a meal or statement by a link that shows only the parts they chose, until they stop sharing.

**Your choices**: append "…, unlink from a cook who cooks for you, and stop sharing a cooked meal or statement".

## Points to decide

1. **Notes about people who aren't users.** A cook's notes about a client can hold health-related
   facts (allergies) about someone who never agreed to our notice. The cook is responsible for those
   notes; the app shows them only to the cook and includes them in the cook's export. Is that
   acceptable, or should notes carry a warning in the app ("only write what they told you to keep")?
2. **Receipt photo retention.** Kept until the cook deletes the receipt or the account (cap 300 per
   cook). Alternative: delete the photo once the receipt is confirmed, keeping only the lines.
3. **Group admins see members' preferences by name when cooking.** This matches what admins already
   see in a group today; the wording above restates it for cooks.
4. **Production stays off** for both flags until this wording is approved.
