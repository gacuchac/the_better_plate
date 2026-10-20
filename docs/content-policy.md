# Content policy: people's own photos

**Status:** working policy and drafts. Not legal advice and not reviewed by counsel. Counsel review is a release gate (PRODUCT.md §5, §7).

## What the product does

- People can upload their own photos to their recipes, in the app or through a connected assistant (`upload_recipe_photo`).
- **Rights:** before uploading, the person confirms they took the photo or have the right to use it. We store the time of that confirmation and where the upload came from (`app` or `assistant`) in `recipe_images.rights_confirmed_at` and `upload_source`.
- **Privacy:** uploads are re-encoded on the server (WebP, at most 1600 px). All metadata is dropped, including GPS location, camera and owner fields.
- **Visibility:** uploaded photos are served only to their owner. Shared recipe links don't include photos. The service doesn't select, edit or promote uploads.

## Why these controls (research, 2026-10-20)

Saying "the user is responsible" in the terms does not on its own protect the service. Hosting safe harbors have conditions:

| Regime | Protection | Conditions relevant here |
|---|---|---|
| US, DMCA 17 U.S.C. §512(c) | No monetary liability for infringing material stored at a user's direction | No actual knowledge and no awareness of facts making the infringement apparent. Remove material expeditiously on notice. No direct financial benefit where the service can control the activity. A repeat-infringer termination policy that is adopted and reasonably implemented. A **designated agent registered with the US Copyright Office** ($6, renew every 3 years), with the agent's details also published on the service. |
| EU, Digital Services Act Art. 6 and 16 | Hosting providers are not liable without knowledge | Act expeditiously once aware. Provide a notice-and-action mechanism for reports of illegal content. |
| Chile, Law 17.336 as amended in 2010 | Exemption for hosting providers | Takedown follows a court order. Publish general conditions for terminating users that a court has found to be repeat infringers. |

Sources: [Proskauer on DMCA agent registration](https://www.proskauer.com/alert/copyright-office-establishes-new-electronic-dmca-agent-registration), [DSA Art. 6](https://presencis.com/regulations/dsa/article-6/), [DSA Art. 16](https://presencis.com/regulations/dsa/article-16/), [Carey on Chile's ISP regime](https://www.carey.cl/news-alert-n2-agosto-2010).

## Owner actions (not done; tracked in OWNER_PREFLIGHT)

1. Decide the operating jurisdiction.
2. If there will be US users, register a DMCA designated agent. It needs a name, a postal address (a PO box is accepted), a phone number and an email.
3. Choose the takedown contact email and publish it with the terms.
4. Have counsel review the draft terms below before public launch.

## Takedown runbook (operator)

On a notice that identifies a specific photo:

1. Record the notice: date, sender and the material identified.
2. Find the image. Notices usually come with a recipe or user context, since photos aren't public.
3. Delete it: `delete from recipe_images where id = $1`. Recipes keep a reference that resolves to no image, and the app shows the recipe without a photo.
4. Tell the uploader, so they can send a counter-notice under the DMCA if they believe it was a mistake.
5. Count notices per account. Repeat infringers lose upload access, and their account is closed after counsel's threshold is applied.

## Draft terms clauses (for counsel)

> **Your photos.** You may add photos to your recipes. You confirm that you took each photo or have the right to use it, and that it doesn't infringe anyone's rights. You keep ownership. You give The Better Plate a limited license to store, resize and show the photo to you, and to include it in your data export. We don't show your photos to other people. If someone tells us a photo infringes their rights, we may remove it and will let you know. We close the accounts of people who repeatedly infringe. To report a photo, contact [takedown email].
