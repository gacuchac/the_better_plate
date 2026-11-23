/**
 * The privacy notice people agree to. Each wording change gets a new version, and people are
 * asked again. Plain language that mirrors docs/privacy-data-map.md; it has not been reviewed
 * by a lawyer (preflight P3), and says so.
 */
export const PRIVACY_NOTICE = {
  version: "2026-11-23",
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
        "When you first sign in with that email and agree to this notice, you are in that group, and you can leave it at any time. " +
        "If you cook for others: your cooking profile, the people you cook for and your notes about them, the meals you cook with their recipes, time and costs, grocery receipts with their photos, your ingredient prices and your statements. " +
        "Only you see your notes and receipt photos. If a cook invites you by email, we keep that email for up to 30 days and send you one email about it. " +
        "If you link accounts with someone: the email you shared yours with, what you chose to share, and a log of what was done through the link, kept 12 months.",
    },
    {
      heading: "What we don't collect",
      body:
        "No phone number, address, date of birth, health history or payment details. Lines on a grocery receipt about how it was paid are left out, and the app takes no payments. No advertising, no analytics trackers and no session recordings.",
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
        "If an admin added you by email, you join when you first sign in with that email, and you can leave right away. " +
        "If someone cooks for you in the app, they see your food preferences, never your meals or goals. A cook in your group sees the group's allergies; only the group's owner and admins see them by name. " +
        "When you accept a cook's invite, you see every meal they cooked for you and whatever they choose to share, and they see your food preferences. " +
        "A cook can also share a meal or statement by a link that shows only the parts they chose, until they stop sharing. " +
        "You can let someone you trust use parts of your account with their own sign-in, such as your recipes, plans or groups, each turned on separately, to view or to change. " +
        "Nothing is shared until they accept, and they can let their AI apps use it only if you allow that too. " +
        "If you share your groups, they act in them as you, and the group sees it as you; your activity log shows what they did.",
    },
    {
      heading: "Your choices",
      body:
        "You can download everything we keep about you at any time, revoke share links, stop sharing community recipes, leave a group or turn down an invite, take back your answer to a shared meal, unlink from a cook who cooks for you, stop sharing a cooked meal or statement, change or end what you share with a linked account, and delete your account, which deletes your data from our database.",
    },
    {
      heading: "About the numbers",
      body: "Nutrition values are estimates from USDA data for learning and planning. They aren't medical advice.",
    },
  ],
} as const;
