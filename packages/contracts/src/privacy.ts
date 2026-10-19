/**
 * The privacy notice people agree to. Each wording change gets a new version, and people are
 * asked again. Plain language that mirrors docs/privacy-data-map.md; it has not been reviewed
 * by a lawyer (preflight P3), and says so.
 */
export const PRIVACY_NOTICE = {
  version: "2026-10-19",
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
        "including a screenshot only if you choose to attach one. For security, each sign-in session keeps the browser's " +
        "description and IP address.",
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
        "Anyone with the link can read it until you revoke it or it expires. It never shows your name, email or meals.",
    },
    {
      heading: "Your choices",
      body:
        "You can download everything we keep about you at any time, revoke share links, and delete your account, which deletes your data from our database.",
    },
    {
      heading: "About the numbers",
      body: "Nutrition values are estimates from USDA data for learning and planning. They aren't medical advice.",
    },
  ],
} as const;
