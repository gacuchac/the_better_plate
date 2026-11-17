/**
 * The privacy notice people agree to. Each wording change gets a new version, and people are
 * asked again. Plain language that mirrors docs/privacy-data-map.md; it has not been reviewed
 * by a lawyer (preflight P3), and says so.
 */
export const PRIVACY_NOTICE = {
  version: "2026-11-17",
  reviewStatus: "draft" as "draft" | "reviewed",
  title: "How The Better Plate handles your data",
  sections: [
    {
      heading: "Who it's for",
      body: "The Better Plate is for adults (18 and over). It isn't meant for children.",
    },
    {
      heading: "What we keep in your account",
      body:
        "Your email address, and a display name if you add one or sign in with Google. The recipes you save, with each saved version. " +
        "Meals you plan and meals you mark as eaten, with the day and meal. Share links you create. Issue reports you send, " +
        "including a screenshot only if you choose to attach one. Recipes you mark as favorites. Recipes you share with the " +
        "community, copies you save from it and reports you send about it. For security, each sign-in session keeps the browser's " +
        "description and IP address. " +
        "Groups you start, join or are added to, with the name you use there. Meals your group shares with you and your answers to them, with any comment you add. " +
        "If someone adds you to a group by email before you have an account, we keep your email and the name they gave for up to 30 days and send you one email about it. " +
        "When you first sign in with that email and agree to this notice, you are in that group, and you can leave it at any time.",
    },
    {
      heading: "What we don't collect",
      body:
        "No phone number, address, date of birth, health history or payment details. No advertising, no analytics trackers and no session recordings.",
    },
    {
      heading: "On this device",
      body:
        "A copy of your kitchen and the USDA food list stay on this device so the app works offline. Signing out removes your personal copy from this device.",
    },
    {
      heading: "Sharing",
      body:
        "A share link shows only what you reviewed before creating it: the recipe, its amounts and the estimate, and your method if you choose. " +
        "Anyone with the link can read it until you revoke it or it expires. " +
        "You can also share a recipe with the community. Everyone signed in to The Better Plate can then read the version you reviewed and save a copy to their own kitchen. " +
        "Copies people already saved stay with them if you stop sharing. Popular recipes are picked by how many different people saved them; nobody sees who saved or reported a recipe. " +
        "Neither a share link nor a community recipe ever shows your name, email or meals. " +
        "In a group, its admins can see the meals you plan and eat for the group, your food preferences and your answers to shared meals, and they can put meals on your plan (marked as planned by them; a plan is never counted as eaten). " +
        "A meal shared in a group shows its name, description, photo and estimated nutrients, not the recipe. " +
        "If an admin added you by email, you join when you first sign in with that email, and you can leave right away.",
    },
    {
      heading: "Your choices",
      body:
        "You can download everything we keep about you at any time, revoke share links, stop sharing community recipes, leave a group or turn down an invite, take back your answer to a shared meal, and delete your account, which deletes your data from our database.",
    },
    {
      heading: "About the numbers",
      body: "Nutrition values are estimates from USDA data for learning and planning. They aren't medical advice.",
    },
  ],
} as const;
