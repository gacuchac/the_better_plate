# Draft: privacy notice change for adding people by email and shared meals

Status: **approved by the owner 2026-11-17** and published as notice version `2026-11-17` in
`packages/contracts/src/privacy.ts` (people are asked to agree again). The owner chose to keep the cloud dev
environment as the live app for now; no production environment exists yet. The open points at the end
(invite email footer, 30 days, counsel review) were not part of the approved wording and stay open.

## Why it changes

Migrations `020_group_invites_meal_shares.sql` and `021_group_auto_join.sql` add three things:

1. **Adding someone by email.** A group admin types another person's email and the name the group will
   see. We keep that email and name for up to 30 days, send one email from the app (the admin can send it
   again after a day), and add them to the group automatically the first time they sign in with that verified email,
   right after they accept the privacy notice (never before). Home then says which group added them and
   who, with a Leave button. Before that sign-in, this is data about someone who has not agreed to our notice yet.
2. **Shared meals.** An admin shares a meal as a snapshot (name, description, a photo, seven estimated
   nutrients per serving; never ingredients or method). Members answer thumbs up or down with an optional
   comment. Only the member and the group's admins see that answer and comment.
3. **Planning for the group.** An admin can put one meal on everyone's plan at once (or on chosen people's).
   It shows on each person's own plan as planned by that admin, and is never counted as eaten.

The current notice (version 2026-11-12) does not mention groups at all, although groups already exist.
This draft covers groups as a whole, so the owner can approve one wording.

## Proposed wording

Bump `version` to the approval date (people are asked to agree again) and change three sections.

**What we keep in your account**: append

> Groups you start, join or are added to, with the name you use there. Meals your group shares with you and your answers to them, with any comment you add. If someone adds you to a group by email before you have an account, we keep your email and the name they gave for up to 30 days and send you one email about it. When you first sign in with that email and agree to this notice, you are in that group, and you can leave it at any time.

**Sharing**: append

> In a group, its admins can see the meals you plan and eat for the group, your food preferences and your answers to shared meals, and they can put meals on your plan (marked as planned by them; a plan is never counted as eaten). A meal shared in a group shows its name, description, photo and estimated nutrients, not the recipe. If an admin added you by email, you join when you first sign in with that email, and you can leave right away.

**Your choices**: append "leave a group or turn down an invite, and take back your answer to a shared meal".

## Points to decide

- Auto-join (Gabriel chose "Join automatically" on 2026-11-17): people added by email join on first sign-in once they accept this notice. The notice they accept must therefore already say so, which is why the wording above mentions it.

- Whether the invite email needs its own short footer ("You got this because {name} added you to {group}. If you don't sign in, we delete your email after 30 days.").
- Whether 30 days is the right time to keep a pending email.
- Counsel review, alongside the existing open item on allergies and children's profiles (R-groups).
