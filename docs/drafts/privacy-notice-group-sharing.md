# Draft: privacy notice change for adding people by email and shared meals

Status: **draft for the owner's approval. Not published.** `packages/contracts/src/privacy.ts` is unchanged.
AGENTS.md requires explicit owner approval for any change to privacy or data-collection scope. Both
features stay off in production (`FEATURE_GROUP_EMAIL_INVITES_ENABLED`, `FEATURE_GROUP_MEAL_SHARES_ENABLED`)
until this is approved.

## Why it changes

Migration `020_group_invites_meal_shares.sql` adds two things:

1. **Adding someone by email.** A group admin types another person's email and the name the group will
   see. We keep that email and name for up to 30 days, send one email from the app (the admin can send it
   again after a day), and show the person the invite when they sign in with that verified email. Nothing
   joins them automatically. This is data about someone who has not agreed to our notice yet.
2. **Shared meals.** An admin shares a meal as a snapshot (name, description, a photo, seven estimated
   nutrients per serving; never ingredients or method). Members answer thumbs up or down with an optional
   comment. Only the member and the group's admins see that answer and comment.

The current notice (version 2026-11-12) does not mention groups at all, although groups already exist.
This draft covers groups as a whole, so the owner can approve one wording.

## Proposed wording

Bump `version` to the approval date (people are asked to agree again) and change three sections.

**What we keep in your account**: append

> Groups you start or join, with the name you use there. Meals your group shares with you and your answers to them, with any comment you add. If someone adds you to a group by email before you have an account, we keep your email and the name they gave for up to 30 days and send you one email about it.

**Sharing**: append

> In a group, its admins can see the meals you plan and eat for the group, your food preferences and your answers to shared meals. A meal shared in a group shows its name, description, photo and estimated nutrients, not the recipe. You join a group only when you choose to.

**Your choices**: append "leave a group or turn down an invite, and take back your answer to a shared meal".

## Points to decide

- Whether the invite email needs its own short footer ("You got this because {name} added you to {group}. If you don't sign in, we delete your email after 30 days.").
- Whether 30 days is the right time to keep a pending email.
- Counsel review, alongside the existing open item on allergies and children's profiles (R-groups).
