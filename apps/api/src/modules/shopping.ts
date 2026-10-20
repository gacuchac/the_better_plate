import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { LocalDateSchema, ShoppingListSchema, type RecipeBody } from "@betterplate/contracts";
import { buildShoppingList, type ShoppingPlan } from "@betterplate/nutrition";
import { pool } from "../db/pool.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../lib/http.ts";
import { isAdminRole, profileOwner, roleIn } from "./access.ts";
import { foodsByIds } from "./catalog.ts";
import { ErrorResponses } from "./common.ts";

type Row = { id: string; local_date: string; title: string; servings: string; status: string; recipe_servings: string | null; ingredients: RecipeBody["ingredients"] | null };

/**
 * Plans in range for one kitchen subject (an account itself, or one of its profiles), or for every
 * member of a group. Recipes are read as they are now, so the list follows later recipe edits.
 */
async function plansFor(where: string, params: unknown[]) {
  const { rows } = await pool.query<Row>(
    `select p.id, to_char(p.local_date, 'YYYY-MM-DD') as local_date, p.title, p.servings, p.status, r.servings as recipe_servings, r.body->'ingredients' as ingredients
       from planned_meals p left join recipes r on r.id = p.recipe_id and r.deleted_at is null
      where p.deleted_at is null and ${where} order by p.local_date, p.slot`,
    params,
  );
  return rows;
}

export const shoppingRoutes = new OpenAPIHono<AppEnv>();
shoppingRoutes.use("/v1/shopping-list", rateLimit("shopping list", 120, 60));

shoppingRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/shopping-list", tags: ["meals"],
    summary: "What to buy for planned meals over a range of days (at most 31)",
    description:
      "Mine by default; one of my profiles' with profileId; or a whole group's with groupId (owner or admin). " +
      "Each food's grams are the recipe's amounts scaled to the servings planned; cooking oil counts what is added. " +
      "Plans waiting for approval are counted apart, not listed. Only plans count; nothing eaten is involved.",
    request: { query: z.object({ from: LocalDateSchema, to: LocalDateSchema, profileId: z.uuid().optional(), groupId: z.uuid().optional() }) },
    responses: { 200: { description: "Shopping list", content: { "application/json": { schema: ShoppingListSchema } } }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const { from, to, profileId, groupId } = c.req.valid("query");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= 30)) throw new ApiError(400, "invalid_range", "Use a range of 1 to 31 days with from ≤ to");
    if (profileId && groupId) throw new ApiError(400, "invalid_request", "Ask for a profile's list or a group's, not both");

    let rows: Row[];
    if (groupId) {
      if (!isAdminRole(await roleIn(pool, groupId, user.id))) throw new ApiError(404, "not_found", "Group not found");
      rows = await plansFor(
        `p.local_date between $2 and $3 and exists (
           select 1 from group_members m where m.group_id = $1
              and ((m.user_id = p.user_id and p.profile_id is null) or m.profile_id = p.profile_id))`,
        [groupId, from, to],
      );
    } else {
      if (profileId && (await profileOwner(pool, profileId)) !== user.id) throw new ApiError(404, "not_found", "Profile not found");
      rows = await plansFor("p.user_id = $1 and p.profile_id is not distinct from $2 and p.local_date between $3 and $4", [user.id, profileId ?? null, from, to]);
    }

    const counted = rows.filter((r) => r.status === "planned");
    const plans: ShoppingPlan[] = counted.map((r) => ({
      planId: r.id,
      date: r.local_date,
      title: r.title,
      servings: Number(r.servings),
      recipe: r.ingredients && r.recipe_servings !== null ? { servings: Number(r.recipe_servings), ingredients: r.ingredients } : null,
    }));
    const foods = await foodsByIds([...new Set(plans.flatMap((p) => p.recipe?.ingredients.map((i) => i.foodId) ?? []))]);
    const list = buildShoppingList(plans, foods);
    return c.json({ from, to, ...list, awaitingApproval: rows.filter((r) => r.status === "proposed").length }, 200);
  },
);
