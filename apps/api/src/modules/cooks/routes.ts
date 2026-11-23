import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CookClientBodySchema,
  CookClientInviteSchema,
  CookClientSchema,
  CookExpenseBodySchema,
  CookMealCreateSchema,
  CookMealListSchema,
  CookMealRecipeAddSchema,
  CookMealSchema,
  CookMealUpdateSchema,
  CookPriceBodySchema,
  CookPriceListSchema,
  CookProfileBodySchema,
  CookProfileStateSchema,
  CookShoppingListSchema,
  CookTargetsSchema,
  CookTimerSchema,
  type CookClient,
  type CookTarget,
} from "@betterplate/contracts";
import { config } from "../../config.ts";
import { pool, withTransaction } from "../../db/pool.ts";
import { sendEmail } from "../../lib/mailer.ts";
import { ApiError, type AppEnv, rateLimit, requireUser } from "../../lib/http.ts";
import { foodsByIds } from "../catalog.ts";
import { ErrorResponses, IdParam } from "../common.ts";
import {
  cookRow,
  editableMeal,
  loadMeal,
  loadMeals,
  recipeSnapshot,
  requireCook,
  requireCookFeature,
  resolveTarget,
  toMeal,
  toProfile,
  toSummary,
  cookingSeconds,
  type Db,
} from "./core.ts";
import { COOK_INVITE_DAYS, COOK_INVITE_EMAILS_PER_DAY, Err, FoodParam, json, MealChildParam } from "./helpers.ts";

export const cookRoutes = new OpenAPIHono<AppEnv>();
cookRoutes.use("/v1/cook/*", rateLimit("cook", 600, 60));
cookRoutes.use("/v1/me/cook*", rateLimit("cook-client", 300, 60));

const state = async (userId: string) => {
  const row = await cookRow(pool, userId);
  return { profile: row ? toProfile(row) : null, features: { clientInvites: config.features.cookClientInvites } };
};

// ---------------------------------------------------------------- profile

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook", tags: ["cook"], summary: "My cook profile, if I set one up",
    responses: { 200: { description: "Profile", ...json(CookProfileStateSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCookFeature();
    return c.json(await state(requireUser(c).id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/cook", tags: ["cook"], summary: "Set up or change my cook profile",
    description: "Business name, currency (USD unless changed) and default rates. No tax is added to a cook's services.",
    request: { body: { required: true, ...json(CookProfileBodySchema) } },
    responses: { 200: { description: "Profile", ...json(CookProfileStateSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    requireCookFeature();
    const user = requireUser(c);
    const b = c.req.valid("json");
    await pool.query(
      `insert into cooks (user_id, business_name, currency, hourly_rate_cents, flat_fee_cents) values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set business_name = excluded.business_name, currency = excluded.currency,
         hourly_rate_cents = excluded.hourly_rate_cents, flat_fee_cents = excluded.flat_fee_cents, updated_at = now()`,
      [user.id, b.businessName, b.currency, b.hourlyRateCents, b.flatFeeCents],
    );
    return c.json(await state(user.id), 200);
  },
);

// ---------------------------------------------------------------- clients

type ClientRow = { id: string; name: string; notes: string; hourly_rate_cents: number | null; invite_email: string | null; invited_at: Date | null; linked_user_id: string | null; linked_at: Date | null; created_at: Date };
const toClient = (r: ClientRow): CookClient => ({
  id: r.id, name: r.name, notes: r.notes, hourlyRateCents: r.hourly_rate_cents,
  inviteEmail: r.invite_email, invitedAt: r.invited_at?.toISOString() ?? null,
  linked: !!r.linked_user_id, linkedAt: r.linked_at?.toISOString() ?? null, createdAt: r.created_at.toISOString(),
});
const ClientList = z.object({ clients: z.array(CookClientSchema) });

async function loadClient(db: Db, cookId: string, id: string): Promise<ClientRow> {
  const { rows } = await db.query<ClientRow>("select * from cook_clients where id = $1 and cook_id = $2", [id, cookId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Client not found");
  return rows[0];
}

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/clients", tags: ["cook"], summary: "My clients",
    responses: { 200: { description: "Clients", ...json(ClientList) }, 409: Err("No cook profile"), ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { rows } = await pool.query<ClientRow>("select * from cook_clients where cook_id = $1 order by lower(name), created_at", [cook.user_id]);
    return c.json({ clients: rows.map(toClient) }, 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/clients", tags: ["cook"], summary: "Add a client",
    description: "A client is a name and your own notes; they don't need to be in the app. Invite them later if you like.",
    request: { body: { required: true, ...json(CookClientBodySchema) } },
    responses: { 201: { description: "Client", ...json(CookClientSchema) }, 409: Err("No cook profile, or too many clients"), ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const b = c.req.valid("json");
    const n = (await pool.query<{ n: string }>("select count(*) as n from cook_clients where cook_id = $1", [cook.user_id])).rows[0]!;
    if (Number(n.n) >= 500) throw new ApiError(409, "client_limit", "You can have up to 500 clients");
    const id = b.id ?? crypto.randomUUID();
    const { rows } = await pool.query<ClientRow>(
      "insert into cook_clients (id, cook_id, name, notes, hourly_rate_cents) values ($1, $2, $3, $4, $5) on conflict (id) do nothing returning *",
      [id, cook.user_id, b.name, b.notes, b.hourlyRateCents],
    );
    return c.json(toClient(rows[0] ?? (await loadClient(pool, cook.user_id, id))), 201);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/cook/clients/{id}", tags: ["cook"], summary: "Change a client's name, notes or rate",
    request: { params: IdParam, body: { required: true, ...json(CookClientBodySchema) } },
    responses: { 200: { description: "Client", ...json(CookClientSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    await loadClient(pool, cook.user_id, id);
    const { rows } = await pool.query<ClientRow>(
      "update cook_clients set name = $3, notes = $4, hourly_rate_cents = $5, updated_at = now() where id = $1 and cook_id = $2 returning *",
      [id, cook.user_id, b.name, b.notes, b.hourlyRateCents],
    );
    return c.json(toClient(rows[0]!), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/clients/{id}", tags: ["cook"], summary: "Remove a client who has no meals",
    request: { params: IdParam },
    responses: { 204: { description: "Removed" }, 409: Err("The client has meals"), ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { id } = c.req.valid("param");
    await loadClient(pool, cook.user_id, id);
    const used = await pool.query("select 1 from cook_meals where client_id = $1 limit 1", [id]);
    if (used.rowCount) throw new ApiError(409, "client_has_meals", "This client has meals; keep them so their history stays");
    await pool.query("delete from cook_clients where id = $1 and cook_id = $2", [id, cook.user_id]);
    return c.body(null, 204);
  },
);

/** One line of plain text: names people typed must not add lines or headers to an email. */
const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();

export function clientInviteEmail(input: { to: string; cook: string; appUrl: string }) {
  const cook = oneLine(input.cook) || "Your cook";
  return {
    to: input.to,
    subject: `${cook} invited you to see the meals they cook for you on The Better Plate`,
    text:
      `${cook} cooks for you and keeps your meals on The Better Plate, an app for cooking at home.\n\n` +
      `Open ${input.appUrl} and sign in with this email address (${input.to}), then accept the invite under You. ` +
      `You'll see the meals cooked for you and whatever ${cook} chooses to share. You can stop at any time.\n\n` +
      `If you don't know ${cook}, you can ignore this email. The invite lapses after ${COOK_INVITE_DAYS} days.`,
  };
}

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/clients/{id}/invite", tags: ["cook"], summary: "Invite a client by email (optional)",
    description:
      "Emails an invite. Once that person signs in with this verified email and accepts, the client is linked to their account: " +
      `they see every meal you cooked for them and what you share, and their own food preferences apply. One email a day per client; lapses after ${COOK_INVITE_DAYS} days.`,
    request: { params: IdParam, body: { required: true, ...json(CookClientInviteSchema) } },
    responses: { 200: { description: "Client", ...json(CookClientSchema) }, 409: Err("Already linked"), 422: Err("Your own email"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const cook = await requireCook(pool, user);
    if (!config.features.cookClientInvites) throw new ApiError(404, "feature_disabled", "Inviting clients is not available");
    const { id } = c.req.valid("param");
    const email = c.req.valid("json").email.trim().toLowerCase();
    if (email === user.email.toLowerCase()) throw new ApiError(422, "own_email", "That's your own email");
    const client = await withTransaction(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtextextended($1, 7))", [cook.user_id]);
      const row = await loadClient(db, cook.user_id, id);
      if (row.linked_user_id) throw new ApiError(409, "client_linked", "This client is already linked");
      const recent = (await db.query<{ sent: boolean }>("select invite_sent_at > now() - interval '24 hours' as sent from cook_clients where id = $1", [id])).rows[0];
      if (recent?.sent) throw new ApiError(429, "invite_resend_limit", "You can send this client one invite email a day");
      const sent = (await db.query<{ n: string }>("select count(*) as n from cook_invite_sends where cook_id = $1 and sent_at > now() - interval '24 hours'", [cook.user_id])).rows[0]!;
      if (Number(sent.n) >= COOK_INVITE_EMAILS_PER_DAY) throw new ApiError(429, "invite_email_limit", `You can send up to ${COOK_INVITE_EMAILS_PER_DAY} invite emails a day`);
      await db.query("insert into cook_invite_sends (cook_id) values ($1)", [cook.user_id]);
      const { rows } = await db.query<ClientRow>(
        "update cook_clients set invite_email = $2, invited_at = now(), invite_sent_at = now(), updated_at = now() where id = $1 returning *",
        [id, email],
      );
      return rows[0]!;
    });
    const name = cook.business_name || user.name;
    try {
      await sendEmail(clientInviteEmail({ to: email, cook: name, appUrl: config.publicAppUrl.replace(/\/$/, "") }));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "cook invite email failed", clientId: id, error: (err as Error).message }));
    }
    return c.json(toClient(client), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/clients/{id}/invite", tags: ["cook"], summary: "Take back a client's invite",
    request: { params: IdParam },
    responses: { 200: { description: "Client", ...json(CookClientSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { id } = c.req.valid("param");
    await loadClient(pool, cook.user_id, id);
    const { rows } = await pool.query<ClientRow>("update cook_clients set invite_email = null, invited_at = null, updated_at = now() where id = $1 returning *", [id]);
    return c.json(toClient(rows[0]!), 200);
  },
);

// ---------------------------------------------------------------- who I can cook for

type PrefRow = { id: string; allergy_answer: "listed" | "none" | "prefer_not"; allergens: string[]; notes: string };
async function prefsFor(db: Db, ids: string[]): Promise<Map<string, PrefRow>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<PrefRow>("select id, allergy_answer, allergens, notes from food_preferences where id = any($1)", [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}
const person = (name: string, p: PrefRow | undefined, extraNotes = "") => ({
  name,
  allergyAnswer: p?.allergy_answer ?? ("unknown" as const),
  allergens: p?.allergy_answer === "listed" ? p.allergens : [],
  notes: [p?.notes ?? "", extraNotes].filter(Boolean).join("\n"),
});
const union = (people: { allergens: string[] }[]) => [...new Set(people.flatMap((p) => p.allergens))].sort();

/**
 * Everyone the cook may cook for, each with what the cook may know of their food needs:
 * themselves; every group they are in (an admin sees each member's needs by name, a plain member
 * only the group's combined allergens); each member of a group they run; their own clients (a
 * linked client's own preferences, otherwise the cook's notes). Never meals eaten or goals.
 */
export async function cookTargets(db: Db, userId: string, userName: string, defaultRate: number | null): Promise<CookTarget[]> {
  const { rows: groups } = await db.query<{ group_id: string; name: string; role: string }>(
    "select m.group_id, g.name, m.role from group_members m join groups g on g.id = m.group_id where m.user_id = $1 order by lower(g.name)",
    [userId],
  );
  const groupIds = groups.map((g) => g.group_id);
  const { rows: members } = groupIds.length
    ? await db.query<{ id: string; group_id: string; user_id: string | null; profile_id: string | null; display_name: string }>(
        "select id, group_id, user_id, profile_id, display_name from group_members where group_id = any($1) order by created_at",
        [groupIds],
      )
    : { rows: [] };
  const { rows: clients } = await db.query<ClientRow>("select * from cook_clients where cook_id = $1 order by lower(name)", [userId]);
  const prefs = await prefsFor(db, [userId, ...members.map((m) => m.profile_id ?? m.user_id!), ...clients.flatMap((c) => (c.linked_user_id ? [c.linked_user_id] : []))]);
  const subject = (m: (typeof members)[number]) => m.profile_id ?? m.user_id!;

  const me = person(userName, prefs.get(userId));
  const out: CookTarget[] = [
    { kind: "me", groupId: null, memberId: null, clientId: null, key: "me", name: userName, groupName: null, info: { allergens: me.allergens, people: [me], anonymous: false }, hourlyRateCents: defaultRate },
  ];
  for (const g of groups) {
    const admin = g.role === "owner" || g.role === "admin";
    const people = members.filter((m) => m.group_id === g.group_id).map((m) => person(m.display_name, prefs.get(subject(m))));
    out.push({
      kind: "group", groupId: g.group_id, memberId: null, clientId: null, key: `group:${g.group_id}`, name: g.name, groupName: null,
      info: { allergens: union(people), people: admin ? people : [], anonymous: !admin }, hourlyRateCents: defaultRate,
    });
  }
  for (const g of groups.filter((x) => x.role === "owner" || x.role === "admin")) {
    for (const m of members.filter((x) => x.group_id === g.group_id && x.user_id !== userId)) {
      const p = person(m.display_name, prefs.get(subject(m)));
      out.push({
        kind: "member", groupId: g.group_id, memberId: m.id, clientId: null, key: `member:${m.id}`, name: m.display_name, groupName: g.name,
        info: { allergens: p.allergens, people: [p], anonymous: false }, hourlyRateCents: defaultRate,
      });
    }
  }
  for (const cl of clients) {
    const own = cl.linked_user_id ? prefs.get(cl.linked_user_id) : undefined;
    const p = person(cl.name, own, cl.notes);
    out.push({
      kind: "client", groupId: null, memberId: null, clientId: cl.id, key: `client:${cl.id}`, name: cl.name, groupName: null,
      info: { allergens: p.allergens, people: [p], anonymous: false }, hourlyRateCents: cl.hourly_rate_cents ?? defaultRate,
    });
  }
  return out;
}

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/targets", tags: ["cook"], summary: "Who I can cook for, with their allergies",
    responses: { 200: { description: "Targets", ...json(CookTargetsSchema) }, 409: Err("No cook profile"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const cook = await requireCook(pool, user);
    return c.json({ targets: await cookTargets(pool, user.id, user.name, cook.hourly_rate_cents) }, 200);
  },
);

// ---------------------------------------------------------------- meals

const mealResponse = async (cookId: string, id: string) => {
  const cook = (await cookRow(pool, cookId))!;
  return toMeal(await loadMeal(pool, cookId, id), cook.currency);
};

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/meals", tags: ["cook"], summary: "My cooked meals, newest first",
    request: { query: z.object({ clientId: z.uuid().optional(), groupId: z.uuid().optional(), memberId: z.uuid().optional(), unbilled: z.enum(["true", "false"]).optional() }) },
    responses: { 200: { description: "Meals", ...json(CookMealListSchema) }, 409: Err("No cook profile"), ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const q = c.req.valid("query");
    const filters: string[] = ["true"];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      filters.push(sql.replace("?", `$${params.length + 1}`));
    };
    if (q.clientId) add("client_id = ?", q.clientId);
    if (q.memberId) add("member_id = ?", q.memberId);
    else if (q.groupId) add("(target_kind = 'group' and group_id = ?)", q.groupId);
    let meals = (await loadMeals(pool, cook.user_id, filters.join(" and "), params)).map(toSummary);
    if (q.unbilled === "true") meals = meals.filter((m) => !m.statementId);
    return c.json({ meals: meals.slice(0, 500), currency: cook.currency }, 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/meals", tags: ["cook"], summary: "Start a cooked meal for someone",
    description: "From the Cook button: who it's for, and optionally the recipe being cooked. The rate comes from the client, else your profile.",
    request: { body: { required: true, ...json(CookMealCreateSchema) } },
    responses: { 201: { description: "Meal", ...json(CookMealSchema) }, 409: Err("No cook profile"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const cook = await requireCook(pool, user);
    const b = c.req.valid("json");
    const existing = await pool.query<{ cook_id: string }>("select cook_id from cook_meals where id = $1", [b.id]);
    if (existing.rows[0]) {
      if (existing.rows[0].cook_id !== user.id) throw new ApiError(404, "not_found", "Meal not found");
      return c.json(await mealResponse(user.id, b.id), 201);
    }
    const target = await resolveTarget(pool, user.id, b.target);
    const recipe = b.recipeId ? await recipeSnapshot(user.id, b.recipeId, b.servings) : null;
    await withTransaction(async (db) => {
      const n = (await db.query<{ n: string }>("select count(*) as n from cook_meals where cook_id = $1", [user.id])).rows[0]!;
      if (Number(n.n) >= 5000) throw new ApiError(409, "meal_limit", "You can keep up to 5000 meals");
      await db.query(
        `insert into cook_meals (id, cook_id, name, cooked_on, target_kind, group_id, member_id, client_id, target_name, hourly_rate_cents, flat_fee_cents)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [b.id, user.id, b.name, b.cookedOn, target.kind, target.groupId, target.memberId, target.clientId, target.name, target.rateCents ?? cook.hourly_rate_cents, cook.flat_fee_cents],
      );
      if (recipe) await insertRecipe(db, b.id, b.recipeId!, recipe);
    });
    return c.json(await mealResponse(user.id, b.id), 201);
  },
);

async function insertRecipe(db: Db, mealId: string, recipeId: string, snap: Awaited<ReturnType<typeof recipeSnapshot>>) {
  const n = (await db.query<{ n: string }>("select count(*) as n from cook_meal_recipes where meal_id = $1", [mealId])).rows[0]!;
  if (Number(n.n) >= 30) throw new ApiError(409, "recipe_limit", "A meal can have up to 30 recipes");
  await db.query(
    "insert into cook_meal_recipes (id, meal_id, recipe_id, title, description, servings, ingredients) values ($1, $2, $3, $4, $5, $6, $7)",
    [crypto.randomUUID(), mealId, recipeId, snap.title, snap.description, snap.servings, JSON.stringify(snap.ingredients)],
  );
}

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/meals/{id}", tags: ["cook"], summary: "A cooked meal with its recipes, receipts, time and costs",
    request: { params: IdParam },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    return c.json(await mealResponse(user.id, c.req.valid("param").id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "patch", path: "/v1/cook/meals/{id}", tags: ["cook"], summary: "Change a meal's name, date, notes, rate or minutes",
    request: { params: IdParam, body: { required: true, ...json(CookMealUpdateSchema) } },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    await withTransaction(async (db) => {
      await editableMeal(db, user.id, id);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (b.name !== undefined) set("name", b.name);
      if (b.cookedOn !== undefined) set("cooked_on", b.cookedOn);
      if (b.notes !== undefined) set("notes", b.notes);
      if (b.hourlyRateCents !== undefined) set("hourly_rate_cents", b.hourlyRateCents);
      if (b.flatFeeCents !== undefined) set("flat_fee_cents", b.flatFeeCents);
      if (b.shoppingMinutes !== undefined) set("shopping_minutes", b.shoppingMinutes);
      if (b.travelMinutes !== undefined) set("travel_minutes", b.travelMinutes);
      if (b.cookingMinutes !== undefined) {
        // Typed-in time replaces what the timer counted, and stops it.
        set("cooking_seconds", b.cookingMinutes * 60);
        sets.push("timer_started_at = null");
      }
      if (sets.length) await db.query(`update cook_meals set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/meals/{id}", tags: ["cook"], summary: "Delete a meal that isn't on a sent statement",
    description: "Its receipt lines go back to unassigned; a draft statement drops it.",
    request: { params: IdParam },
    responses: { 204: { description: "Deleted" }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id } = c.req.valid("param");
    await withTransaction(async (db) => {
      await editableMeal(db, user.id, id);
      await db.query("delete from cook_meals where id = $1", [id]);
    });
    return c.body(null, 204);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/meals/{id}/recipes", tags: ["cook"], summary: "Add a recipe to a meal",
    description: "Kept as cooked: later edits to the recipe don't change the meal.",
    request: { params: IdParam, body: { required: true, ...json(CookMealRecipeAddSchema) } },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    const snap = await recipeSnapshot(user.id, b.recipeId, b.servings);
    await withTransaction(async (db) => {
      await editableMeal(db, user.id, id);
      await insertRecipe(db, id, b.recipeId, snap);
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/meals/{id}/recipes/{childId}", tags: ["cook"], summary: "Take a recipe off a meal",
    request: { params: MealChildParam },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id, childId } = c.req.valid("param");
    await withTransaction(async (db) => {
      await editableMeal(db, user.id, id);
      await db.query("delete from cook_meal_recipes where id = $1 and meal_id = $2", [childId, id]);
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/meals/{id}/timer", tags: ["cook"], summary: "Start, pause or stop the cooking timer",
    description: "Pause and stop both add the running time to the meal; stop is pause from the cook screen's last step.",
    request: { params: IdParam, body: { required: true, ...json(CookTimerSchema) } },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id } = c.req.valid("param");
    const { action } = c.req.valid("json");
    await withTransaction(async (db) => {
      const b = await editableMeal(db, user.id, id);
      if (action === "start") {
        if (!b.row.timer_started_at) await db.query("update cook_meals set timer_started_at = now(), updated_at = now() where id = $1", [id]);
      } else if (b.row.timer_started_at) {
        await db.query("update cook_meals set cooking_seconds = least($2, 864000), timer_started_at = null, updated_at = now() where id = $1", [id, cookingSeconds(b.row)]);
      }
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "post", path: "/v1/cook/meals/{id}/expenses", tags: ["cook"], summary: "Add another cost to a meal",
    request: { params: IdParam, body: { required: true, ...json(CookExpenseBodySchema) } },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    await withTransaction(async (db) => {
      const meal = await editableMeal(db, user.id, id);
      if (meal.expenses.length >= 50) throw new ApiError(409, "expense_limit", "A meal can have up to 50 other costs");
      await db.query("insert into cook_expenses (id, meal_id, label, amount_cents) values ($1, $2, $3, $4)", [crypto.randomUUID(), id, b.label, b.amountCents]);
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/meals/{id}/expenses/{childId}", tags: ["cook"], summary: "Remove a cost from a meal",
    request: { params: MealChildParam },
    responses: { 200: { description: "Meal", ...json(CookMealSchema) }, 409: Err("On a sent statement"), ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    await requireCook(pool, user);
    const { id, childId } = c.req.valid("param");
    await withTransaction(async (db) => {
      await editableMeal(db, user.id, id);
      await db.query("delete from cook_expenses where id = $1 and meal_id = $2", [childId, id]);
    });
    return c.json(await mealResponse(user.id, id), 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/meals/{id}/shopping-list", tags: ["cook"], summary: "What to buy for a meal, with an estimate from my prices",
    request: { params: IdParam },
    responses: { 200: { description: "Shopping list", ...json(CookShoppingListSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const user = requireUser(c);
    const cook = await requireCook(pool, user);
    const b = await loadMeal(pool, user.id, c.req.valid("param").id);
    const bought = new Set(b.lines.flatMap((l) => (l.food_id ? [l.food_id] : [])));
    const byFood = new Map<string, { description: string; grams: number | null }>();
    for (const r of b.recipes) {
      for (const i of r.ingredients) {
        const cur = byFood.get(i.foodId);
        byFood.set(i.foodId, { description: i.description, grams: cur ? (cur.grams === null || i.grams === null ? null : cur.grams + i.grams) : i.grams });
      }
    }
    const items = [...byFood].map(([foodId, v]) => {
      const perKg = b.prices.get(foodId);
      const estimateCents = perKg !== undefined && v.grams !== null ? Math.round((perKg * v.grams) / 1000) : null;
      return { foodId, description: v.description, grams: v.grams === null ? null : Math.round(v.grams), bought: bought.has(foodId), estimateCents };
    });
    items.sort((a, z2) => Number(a.bought) - Number(z2.bought) || a.description.localeCompare(z2.description));
    return c.json({ items, estimateCents: items.filter((i) => !i.bought).reduce((s, i) => s + (i.estimateCents ?? 0), 0), currency: cook.currency }, 200);
  },
);

// ---------------------------------------------------------------- price list

cookRoutes.openapi(
  createRoute({
    method: "get", path: "/v1/cook/prices", tags: ["cook"], summary: "What I last paid per kilogram for each food",
    responses: { 200: { description: "Prices", ...json(CookPriceListSchema) }, ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { rows } = await pool.query<{ food_id: string; cents_per_kg: string; source: "receipt" | "manual"; updated_at: Date }>(
      "select food_id, cents_per_kg, source, updated_at from ingredient_prices where cook_id = $1",
      [cook.user_id],
    );
    const foods = await foodsByIds(rows.map((r) => r.food_id));
    const prices = rows
      .map((r) => ({ foodId: r.food_id, description: foods.get(r.food_id)?.description ?? r.food_id, centsPerKg: Number(r.cents_per_kg), source: r.source, updatedAt: r.updated_at.toISOString() }))
      .sort((a, b) => a.description.localeCompare(b.description));
    return c.json({ prices, currency: cook.currency }, 200);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "put", path: "/v1/cook/prices/{foodId}", tags: ["cook"], summary: "Set what I pay per kilogram for a food",
    request: { params: FoodParam, body: { required: true, ...json(CookPriceBodySchema) } },
    responses: { 204: { description: "Saved" }, ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    const { foodId } = c.req.valid("param");
    if (!(await foodsByIds([foodId])).has(foodId)) throw new ApiError(404, "not_found", "Food not found");
    await pool.query(
      `insert into ingredient_prices (cook_id, food_id, cents_per_kg, source) values ($1, $2, $3, 'manual')
       on conflict (cook_id, food_id) do update set cents_per_kg = excluded.cents_per_kg, source = 'manual', updated_at = now()`,
      [cook.user_id, foodId, c.req.valid("json").centsPerKg],
    );
    return c.body(null, 204);
  },
);

cookRoutes.openapi(
  createRoute({
    method: "delete", path: "/v1/cook/prices/{foodId}", tags: ["cook"], summary: "Forget a saved price",
    request: { params: FoodParam },
    responses: { 204: { description: "Removed" }, ...ErrorResponses },
  }),
  async (c) => {
    const cook = await requireCook(pool, requireUser(c));
    await pool.query("delete from ingredient_prices where cook_id = $1 and food_id = $2", [cook.user_id, c.req.valid("param").foodId]);
    return c.body(null, 204);
  },
);
