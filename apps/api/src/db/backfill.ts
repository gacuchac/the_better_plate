import type pg from "pg";
import type { RecipeBody } from "@betterplate/contracts";
import { withInferredCooking } from "@betterplate/nutrition";
import { foodsByIds } from "../modules/catalog.ts";
import { groupUserIds, lockUsers } from "../modules/access.ts";
import { computeNutrition } from "../modules/recipes.ts";

export const COOKING_BACKFILL = "2026-11_ingredient_cooking_state";

export interface CookingBackfillResult {
  recipes: number;
  ingredients: number;
  cooked: number;
  raw: number;
}

/**
 * ADR-014: recipes saved before ingredients had a cooked or raw state get one guessed from their
 * method, marked as a guess, and their nutrition recomputed. Each recipe gets a new version (so
 * devices sync it) and a revision row; the previous version stays in recipe_revisions. Runs once.
 */
export async function backfillCookingState(pool: pg.Pool, log: (msg: string) => void = console.info): Promise<CookingBackfillResult | null> {
  const done = await pool.query("select 1 from data_backfills where name = $1", [COOKING_BACKFILL]);
  if (done.rowCount) return null;
  const result: CookingBackfillResult = { recipes: 0, ingredients: 0, cooked: 0, raw: 0 };
  const { rows: ids } = await pool.query<{ id: string }>(
    `select id from recipes where deleted_at is null
       and exists (select 1 from jsonb_array_elements(coalesce(body->'ingredients', '[]'::jsonb)) i where i->'cooking' is null or i->'cooking' = 'null'::jsonb)`,
  );
  for (const { id } of ids) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const pre = (await client.query<{ user_id: string; group_id: string | null }>("select user_id, group_id from recipes where id = $1", [id])).rows[0];
      if (!pre) {
        await client.query("rollback");
        continue;
      }
      await lockUsers(client, [pre.user_id, ...(pre.group_id ? await groupUserIds(client, pre.group_id) : [])]);
      const row = (
        await client.query<{ title: string; servings: string; body: Partial<RecipeBody>; version: number; deleted_at: Date | null }>(
          "select title, servings, body, version, deleted_at from recipes where id = $1 for update",
          [id],
        )
      ).rows[0];
      const ingredients = row?.body.ingredients ?? [];
      if (!row || row.deleted_at || !ingredients.some((i) => !i.cooking)) {
        await client.query("rollback");
        continue;
      }
      const foods = await foodsByIds(ingredients.map((i) => i.foodId));
      const filled = withInferredCooking(row.body.method ?? "", ingredients, foods);
      const calc = await computeNutrition({ servings: Number(row.servings), ingredients: filled });
      if (!calc.ok) {
        log(`backfill: recipe ${id} skipped, foods not in catalog: ${calc.unknown.join(", ")}`);
        await client.query("rollback");
        continue;
      }
      const body = { ...row.body, ingredients: filled };
      const version = row.version + 1;
      await client.query(
        `update recipes set body = $2, nutrition = $3, version = $4, server_seq = nextval('change_seq'), updated_at = now() where id = $1`,
        [id, JSON.stringify(body), JSON.stringify(calc.nutrition), version],
      );
      await client.query(
        `insert into recipe_revisions (recipe_id, version, user_id, body, nutrition, catalog_version) values ($1, $2, $3, $4, $5, $6)`,
        [id, version, pre.user_id, JSON.stringify({ title: row.title, servings: Number(row.servings), ...body }), JSON.stringify(calc.nutrition), calc.nutrition.catalogVersion],
      );
      await client.query("commit");
      const newly = filled.filter((f, i) => !ingredients[i]!.cooking);
      result.recipes += 1;
      result.ingredients += newly.length;
      result.cooked += newly.filter((f) => f.cooking?.state === "cooked").length;
      result.raw += newly.filter((f) => f.cooking?.state === "raw").length;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.query("insert into data_backfills (name, details) values ($1, $2) on conflict (name) do nothing", [COOKING_BACKFILL, JSON.stringify(result)]);
  log(`backfill ${COOKING_BACKFILL}: ${result.recipes} recipes, ${result.ingredients} ingredients guessed (${result.cooked} cooked, ${result.raw} raw)`);
  return result;
}
