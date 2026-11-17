# ADR-013: Home and Kitchen, a calmer phone layout

**Status:** accepted (owner request, Gabriel, 2026-11-17: "the landing button should say home and kitchen should be where you have all your recipes"; redesign brief: simple and uncluttered, fewer images on screen, every main job in three taps or fewer)

**Context:** The landing tab was called Kitchen but showed today, while every recipe sat behind a "Your recipes" link below the fold. Planning a meal from the landing screen took four taps (today card, Plan a meal, recipe, Add to plan), and so did logging a meal that wasn't planned (Your recipes, recipe, I ate this, Save). Home showed recipe photos in the trail and as photo tiles for favorites and trending, and Kitchen showed a two-column grid of large photos.

**Options compared** (clickable mockup with tap counts kept by the owner's thread):
- **A, Today first (chosen):** tabs Home, Kitchen, Create, Groups, You. Home is today with Plan a meal and I ate something on it; Kitchen is every recipe plus the shopping list and the food lookup.
- **B, Plan tab:** Home, Kitchen, Plan, You; Groups inside You. Splits today across two tabs and puts Groups and community picks one tap deeper.
- **C, One plus button:** Home, Kitchen, You and a plus menu. The extra menu tap brings planning and logging back to four.

**Decision:** A. Routes: `#/home` (and any unknown route) is Home; `#/kitchen` and the old `#/recipes` are Kitchen; `#/explore` stays and sits under Kitchen ("Look up a food"); `#/meals` and `#/cheers` sit under Home. Home shows no photos: the trail is text with pins, favorites are chips, trending is a short list. Photos stay on the recipe itself and as a 48px thumbnail in the Kitchen list. A shared picker (`PickRecipe`) plans or logs a recipe in two taps from Home or Meals, favorites first. Kitchen gets a search box once there are more than five recipes.

**Tap counts from Home, before → after:** mark a planned meal eaten 1 → 1; plan a meal 4 → 3; log an unplanned meal 4 → 3; open a recipe 2 → 2; cook 3 → 3; new recipe 1 → 1; today's nutrients 2 → 2; shopping list 1 → 2; look up a food 2 → 3; trending recipe 1 → 1; goals 1 → 1; groups 1 → 1.

**Consequences:** PRODUCT.md navigation is amended (Explore is no longer a root tab; its food lookup is one tap inside Kitchen). Old `#/kitchen` bookmarks now open the recipe list, not today. No API, data or flag change. E2E and the hosted check match the new labels. Revert by restoring the NAV entries and the Home/Kitchen route mapping in `ui/App.tsx`.
