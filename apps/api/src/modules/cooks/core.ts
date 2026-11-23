import type pg from "pg";
import type {
  CookMeal,
  CookMealSummary,
  CookProfile,
  CookShareParts,
  CookSharedMeal,
  CookTargetRef,
  CookTotals,
} from "@betterplate/contracts";
import { ingredientGrams } from "@betterplate/nutrition";
import { config } from "../../config.ts";
import { pool } from "../../db/pool.ts";
import { ApiError, type AuthUser } from "../../lib/http.ts";
import { isAdminRole, roleIn } from "../access.ts";
import { foodsByIds } from "../catalog.ts";
import { getReadableRecipe } from "../recipes.ts";

export type Db = Pick<pg.PoolClient, "query">;
export type Currency = CookProfile["currency"];

export function requireCookFeature() {
  if (!config.features.cookProfile) throw new ApiError(404, "feature_disabled", "The cook profile is not available");
}

export type CookRow = { user_id: string; business_name: string; currency: Currency; hourly_rate_cents: number | null; flat_fee_cents: number | null; created_at: Date };

export const toProfile = (r: CookRow): CookProfile => ({
  businessName: r.business_name,
  currency: r.currency,
  hourlyRateCents: r.hourly_rate_cents,
  flatFeeCents: r.flat_fee_cents,
  createdAt: r.created_at.toISOString(),
});

export async function cookRow(db: Db, userId: string): Promise<CookRow | null> {
  return (await db.query<CookRow>("select * from cooks where user_id = $1", [userId])).rows[0] ?? null;
}

/** The signed-in person's cook profile; the cook screens need one first. */
export async function requireCook(db: Db, user: AuthUser): Promise<CookRow> {
  requireCookFeature();
  const row = await cookRow(db, user.id);
  if (!row) throw new ApiError(409, "no_cook_profile", "Set up your cook profile first");
  return row;
}

/** The name a cook goes by with the people they cook for. */
export async function cookName(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{ business_name: string; name: string | null }>(
    `select c.business_name, u.name from cooks c join "users" u on u.id = c.user_id where c.user_id = $1`,
    [userId],
  );
  return rows[0]?.business_name || rows[0]?.name || "Your cook";
}

// ---------------------------------------------------------------- targets

export interface ResolvedTarget {
  kind: CookTargetRef["kind"];
  groupId: string | null;
  memberId: string | null;
  clientId: string | null;
  name: string;
  /** The target's own hourly rate (a client's), if any. */
  rateCents: number | null;
}

/** Checks the cook may cook for this target and names it. */
export async function resolveTarget(db: Db, cookId: string, ref: CookTargetRef): Promise<ResolvedTarget> {
  const base = { groupId: null, memberId: null, clientId: null, rateCents: null };
  if (ref.kind === "me") return { ...base, kind: "me", name: "" };
  if (ref.kind === "client") {
    const { rows } = await db.query<{ id: string; name: string; hourly_rate_cents: number | null }>("select id, name, hourly_rate_cents from cook_clients where id = $1 and cook_id = $2", [ref.clientId ?? null, cookId]);
    if (!rows[0]) throw new ApiError(404, "not_found", "Client not found");
    return { ...base, kind: "client", clientId: rows[0].id, name: rows[0].name, rateCents: rows[0].hourly_rate_cents };
  }
  if (ref.kind === "group") {
    if (!ref.groupId || !(await roleIn(db, ref.groupId, cookId))) throw new ApiError(404, "not_found", "Group not found");
    const { rows } = await db.query<{ name: string }>("select name from groups where id = $1", [ref.groupId]);
    return { ...base, kind: "group", groupId: ref.groupId, name: rows[0]!.name };
  }
  const { rows } = await db.query<{ id: string; group_id: string; display_name: string; user_id: string | null }>("select id, group_id, display_name, user_id from group_members where id = $1", [ref.memberId ?? null]);
  const m = rows[0];
  if (!m || m.user_id === cookId || !isAdminRole(await roleIn(db, m.group_id, cookId))) throw new ApiError(404, "not_found", "Member not found");
  return { ...base, kind: "member", groupId: m.group_id, memberId: m.id, name: m.display_name };
}

// ---------------------------------------------------------------- meals and their costs

export type MealRow = {
  id: string; cook_id: string; name: string; cooked_on: string; target_kind: CookTargetRef["kind"]; group_id: string | null; member_id: string | null; client_id: string | null;
  target_name: string; hourly_rate_cents: number | null; flat_fee_cents: number | null; cooking_seconds: number; timer_started_at: Date | null;
  shopping_minutes: number; travel_minutes: number; notes: string; created_at: Date; updated_at: Date;
};
export const MEAL_COLUMNS = "id, cook_id, name, to_char(cooked_on, 'YYYY-MM-DD') as cooked_on, target_kind, group_id, member_id, client_id, target_name, hourly_rate_cents, flat_fee_cents, cooking_seconds, timer_started_at, shopping_minutes, travel_minutes, notes, created_at, updated_at";

export interface StoredIngredient {
  foodId: string;
  description: string;
  grams: number | null;
}
type RecipeRow = { id: string; meal_id: string; recipe_id: string | null; title: string; description: string; servings: string; ingredients: StoredIngredient[] };
type LineRow = { id: string; receipt_id: string; meal_id: string; text: string; food_id: string | null; price_cents: number; tax_cents: number; store: string; purchased_on: string | null };
type ExpenseRow = { id: string; meal_id: string; label: string; amount_cents: number };

export interface MealBundle {
  row: MealRow;
  recipes: RecipeRow[];
  lines: LineRow[];
  expenses: ExpenseRow[];
  statementId: string | null;
  statementStatus: string | null;
  shared: boolean;
  prices: Map<string, number>;
}

export async function loadMeals(db: Db, cookId: string, where: string, params: unknown[]): Promise<MealBundle[]> {
  const { rows } = await db.query<MealRow>(`select ${MEAL_COLUMNS} from cook_meals where cook_id = $1 and (${where}) order by cooked_on desc, created_at desc`, [cookId, ...params]);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [recipes, lines, expenses, statements, shares, prices] = await Promise.all([
    db.query<RecipeRow>("select id, meal_id, recipe_id, title, description, servings, ingredients from cook_meal_recipes where meal_id = any($1) order by created_at", [ids]),
    db.query<LineRow>(
      `select l.id, l.receipt_id, l.meal_id, l.text, l.food_id, l.price_cents, l.tax_cents, r.store, to_char(r.purchased_on, 'YYYY-MM-DD') as purchased_on
         from cook_receipt_lines l join cook_receipts r on r.id = l.receipt_id
        where l.meal_id = any($1) and r.status = 'confirmed' order by r.purchased_on nulls last, l.position`,
      [ids],
    ),
    db.query<ExpenseRow>("select id, meal_id, label, amount_cents from cook_expenses where meal_id = any($1) order by created_at", [ids]),
    db.query<{ meal_id: string; id: string; status: string }>(
      "select sm.meal_id, s.id, s.status from cook_statement_meals sm join cook_statements s on s.id = sm.statement_id where sm.meal_id = any($1) and s.status <> 'void'",
      [ids],
    ),
    db.query<{ meal_id: string }>("select meal_id from cook_shares where meal_id = any($1)", [ids]),
    db.query<{ food_id: string; cents_per_kg: string }>("select food_id, cents_per_kg from ingredient_prices where cook_id = $1", [cookId]),
  ]);
  const by = <T extends { meal_id: string }>(list: T[], id: string) => list.filter((x) => x.meal_id === id);
  const priceMap = new Map(prices.rows.map((p) => [p.food_id, Number(p.cents_per_kg)]));
  const shared = new Set(shares.rows.map((s) => s.meal_id));
  return rows.map((row) => {
    const st = statements.rows.find((s) => s.meal_id === row.id);
    return { row, recipes: by(recipes.rows, row.id), lines: by(lines.rows, row.id), expenses: by(expenses.rows, row.id), statementId: st?.id ?? null, statementStatus: st?.status ?? null, shared: shared.has(row.id), prices: priceMap };
  });
}

export function cookingSeconds(row: Pick<MealRow, "cooking_seconds" | "timer_started_at">, now = Date.now()): number {
  const running = row.timer_started_at ? Math.max(0, Math.floor((now - row.timer_started_at.getTime()) / 1000)) : 0;
  return row.cooking_seconds + running;
}

/** Ingredient costs of a meal: what a receipt for this meal covers, else the saved price. */
export function ingredientCosts(b: MealBundle) {
  const covered = new Set(b.lines.flatMap((l) => (l.food_id ? [l.food_id] : [])));
  return b.recipes.map((r) => ({
    recipe: r,
    ingredients: r.ingredients.map((i) => {
      if (covered.has(i.foodId)) return { ...i, source: "receipt" as const, costCents: null };
      const perKg = b.prices.get(i.foodId);
      if (perKg === undefined || i.grams === null) return { ...i, source: "none" as const, costCents: null };
      return { ...i, source: "price_list" as const, costCents: Math.round((perKg * i.grams) / 1000) };
    }),
  }));
}

export function mealTotals(b: MealBundle): CookTotals {
  const costs = ingredientCosts(b);
  const receiptCents = b.lines.reduce((s, l) => s + l.price_cents + l.tax_cents, 0);
  const all = costs.flatMap((c) => c.ingredients);
  const pantryCents = all.reduce((s, i) => s + (i.costCents ?? 0), 0);
  const unpricedIngredients = all.filter((i) => i.source === "none").length;
  const expensesCents = b.expenses.reduce((s, e) => s + e.amount_cents, 0);
  const cooking = Math.round(cookingSeconds(b.row) / 60);
  const minutes = { cooking, shopping: b.row.shopping_minutes, travel: b.row.travel_minutes, total: cooking + b.row.shopping_minutes + b.row.travel_minutes };
  const timeCents = Math.round((minutes.total * (b.row.hourly_rate_cents ?? 0)) / 60);
  const flatFeeCents = b.row.flat_fee_cents ?? 0;
  const groceriesCents = receiptCents + pantryCents;
  return { receiptCents, pantryCents, groceriesCents, unpricedIngredients, expensesCents, minutes, timeCents, flatFeeCents, totalCents: groceriesCents + expensesCents + timeCents + flatFeeCents };
}

const targetOf = (r: MealRow) => ({ kind: r.target_kind, groupId: r.group_id, memberId: r.member_id, clientId: r.client_id, name: r.target_kind === "me" ? "" : r.target_name });

export function toSummary(b: MealBundle): CookMealSummary {
  return {
    id: b.row.id,
    name: b.row.name,
    cookedOn: b.row.cooked_on,
    target: targetOf(b.row),
    recipeTitles: b.recipes.map((r) => r.title),
    totals: mealTotals(b),
    statementId: b.statementId,
    shared: b.shared,
    timerRunning: !!b.row.timer_started_at,
  };
}

export function toMeal(b: MealBundle, currency: Currency): CookMeal {
  return {
    ...toSummary(b),
    notes: b.row.notes,
    hourlyRateCents: b.row.hourly_rate_cents,
    flatFeeCents: b.row.flat_fee_cents,
    timerStartedAt: b.row.timer_started_at?.toISOString() ?? null,
    cookingSeconds: cookingSeconds(b.row),
    shoppingMinutes: b.row.shopping_minutes,
    travelMinutes: b.row.travel_minutes,
    recipes: ingredientCosts(b).map(({ recipe, ingredients }) => ({
      id: recipe.id, recipeId: recipe.recipe_id, title: recipe.title, description: recipe.description, servings: Number(recipe.servings), ingredients,
    })),
    receiptLines: b.lines.map((l) => ({ id: l.id, receiptId: l.receipt_id, store: l.store, purchasedOn: l.purchased_on, text: l.text, foodId: l.food_id, priceCents: l.price_cents, taxCents: l.tax_cents })),
    expenses: b.expenses.map((e) => ({ id: e.id, label: e.label, amountCents: e.amount_cents })),
    currency,
    locked: b.statementStatus === "sent" || b.statementStatus === "paid",
  };
}

export async function loadMeal(db: Db, cookId: string, mealId: string): Promise<MealBundle> {
  const [b] = await loadMeals(db, cookId, "id = $2", [mealId]);
  if (!b) throw new ApiError(404, "not_found", "Meal not found");
  return b;
}

/** A meal on a sent or paid statement can't change: what was billed stays as billed. */
export async function editableMeal(db: Db, cookId: string, mealId: string): Promise<MealBundle> {
  const b = await loadMeal(db, cookId, mealId);
  if (b.statementStatus === "sent" || b.statementStatus === "paid") throw new ApiError(409, "meal_locked", "This meal is on a statement you sent; void the statement to change it");
  return b;
}

/** Snapshot of a recipe as cooked: grams per ingredient for the servings cooked. */
export async function recipeSnapshot(userId: string, recipeId: string, servingsCooked?: number) {
  const recipe = await getReadableRecipe(userId, recipeId);
  if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
  const servings = servingsCooked ?? recipe.servings;
  const foods = await foodsByIds([...new Set(recipe.ingredients.map((i) => i.foodId))]);
  const scale = servings / recipe.servings;
  const ingredients: StoredIngredient[] = recipe.ingredients.map((i) => {
    const food = foods.get(i.foodId);
    const g = ingredientGrams({ ...i, portionIndex: i.portionIndex ?? null, oilDiscardedGrams: i.oilDiscardedGrams ?? null } as never, food as never);
    return { foodId: i.foodId, description: food?.description ?? i.foodId, grams: g === null ? null : Math.round(g * scale * 10) / 10 };
  });
  return { title: recipe.title, description: recipe.description ?? "", servings, ingredients };
}

// ---------------------------------------------------------------- what a share holds

/** Built only from the parts switched on; nothing else of the meal is ever in it. */
export function sharedMeal(b: MealBundle, parts: CookShareParts, name: string, currency: Currency): CookSharedMeal {
  const totals = mealTotals(b);
  const costs = ingredientCosts(b).flatMap((c) => c.ingredients).filter((i) => i.costCents !== null);
  return {
    name: b.row.name,
    cookedOn: b.row.cooked_on,
    cookName: name,
    recipes: b.recipes.map((r) => ({ title: r.title, description: r.description, servings: Number(r.servings) })),
    groceries: parts.groceries
      ? {
          lines: [...b.lines.map((l) => ({ text: l.text, costCents: l.price_cents + l.tax_cents })), ...costs.map((i) => ({ text: i.description, costCents: i.costCents! }))],
          totalCents: totals.groceriesCents,
        }
      : null,
    time: parts.time ? { minutes: totals.minutes.total, costCents: totals.timeCents } : null,
    totals: parts.totals ? { expensesCents: totals.expensesCents, flatFeeCents: totals.flatFeeCents, totalCents: totals.totalCents } : null,
    currency,
  };
}

/** The basics only: what a group's plain members see of a shared meal. */
export function basicsOnly(meal: CookSharedMeal): CookSharedMeal {
  return { ...meal, groceries: null, time: null, totals: null };
}
