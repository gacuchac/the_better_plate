import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MilestonesSchema, MyMilestoneSchema } from "@betterplate/contracts";
import { isoWeek } from "@betterplate/nutrition";
import { pool } from "../src/db/pool.ts";
import { config } from "../src/config.ts";
import { acceptedWeeks } from "../src/modules/milestones.ts";
import { type Client, findFood, signIn } from "./helpers.ts";

let kale: string;
let rice: string;
let chicken: string;

const uuid = () => crypto.randomUUID();
const thisWeek = () => isoWeek(new Date().toISOString().slice(0, 10));

beforeAll(async () => {
  kale = await findFood("Kale, raw");
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  chicken = await findFood("Chicken, broilers or fryers, breast, meat only, cooked, roasted");
});
afterAll(() => pool.end());

const list = async (client: Client) => {
  const res = await client.request("/v1/milestones");
  expect(res.status).toBe(200);
  return MilestonesSchema.parse(await res.json());
};

async function share(client: Client, body: Record<string, unknown>) {
  const res = await client.request("/v1/milestones", { method: "POST", json: { week: thisWeek(), ...body } });
  expect(res.status).toBe(201);
  return MyMilestoneSchema.parse(await res.json());
}

describe("shared milestones", () => {
  it("shares a milestone others can cheer, without the author, counts or amounts", async () => {
    const [ann, ben, cal] = await Promise.all([signIn(), signIn(), signIn()]);
    const m = await share(ann, { kind: "new_plant", foodId: kale });
    expect(m).toMatchObject({ kind: "new_plant", week: thisWeek(), foodId: kale, foodName: "Kale", cheers: { well_done: 0, keep_going: 0, love_this: 0 } });

    const seen = (await list(ben)).feed.find((p) => p.milestoneId === m.milestoneId);
    expect(seen).toEqual({ milestoneId: m.milestoneId, kind: "new_plant", week: thisWeek(), foodName: "Kale", sharedAt: m.sharedAt, myCheer: null });
    // Nothing that identifies the author or ranks the post leaves the server.
    const raw = JSON.stringify(await (await ben.request("/v1/milestones")).json());
    expect(raw).not.toContain(ann.email);
    expect(raw).not.toMatch(/user_?id|cheers/i);
    // My own milestones are not in my feed.
    expect((await list(ann)).feed.some((p) => p.milestoneId === m.milestoneId)).toBe(false);

    expect((await ben.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "well_done" } })).status).toBe(204);
    // Cheering again replaces the cheer: one per person.
    expect((await ben.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "love_this" } })).status).toBe(204);
    expect((await cal.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "keep_going" } })).status).toBe(204);
    expect((await list(ben)).feed.find((p) => p.milestoneId === m.milestoneId)!.myCheer).toBe("love_this");
    expect((await list(ann)).mine.find((p) => p.milestoneId === m.milestoneId)!.cheers).toEqual({ well_done: 0, keep_going: 1, love_this: 1 });

    expect((await cal.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "DELETE" })).status).toBe(204);
    expect((await list(ann)).mine.find((p) => p.milestoneId === m.milestoneId)!.cheers).toEqual({ well_done: 0, keep_going: 0, love_this: 1 });

    const exported = await (await ann.request("/v1/me/export")).json();
    expect(exported.milestones).toEqual([{ milestoneId: m.milestoneId, kind: "new_plant", week: thisWeek(), foodId: kale, sharedAt: m.sharedAt, cheers: 1 }]);
    expect((await (await ben.request("/v1/me/export")).json()).cheersGiven).toEqual([expect.objectContaining({ milestoneId: m.milestoneId, cheer: "love_this" })]);
  });

  it("can't cheer your own milestone, and stopping sharing deletes it and its cheers", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    const m = await share(ann, { kind: "home_dinners" });
    expect((await ann.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "well_done" } })).status).toBe(404);
    await ben.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "well_done" } });

    // Only the author can stop sharing.
    expect((await ben.request(`/v1/milestones/${m.milestoneId}`, { method: "DELETE" })).status).toBe(204);
    expect((await list(ann)).mine).toHaveLength(1);
    expect((await ann.request(`/v1/milestones/${m.milestoneId}`, { method: "DELETE" })).status).toBe(204);
    expect((await list(ann)).mine).toHaveLength(0);
    expect((await list(ben)).feed.some((p) => p.milestoneId === m.milestoneId)).toBe(false);
    expect((await pool.query("select 1 from milestone_cheers where post_id = $1", [m.milestoneId])).rowCount).toBe(0);
    expect((await ben.request(`/v1/milestones/${m.milestoneId}/cheer`, { method: "PUT", json: { cheer: "well_done" } })).status).toBe(404);
  });

  it("keeps one milestone of each kind per week", async () => {
    const ann = await signIn();
    const first = await share(ann, { kind: "planned_and_ate" });
    const again = await share(ann, { kind: "planned_and_ate" });
    expect(again.milestoneId).toBe(first.milestoneId);
    expect((await list(ann)).mine).toHaveLength(1);
  });

  it("refuses free text, unknown kinds, foods that aren't plants and weeks long past", async () => {
    const ann = await signIn();
    const post = (json: Record<string, unknown>) => ann.request("/v1/milestones", { method: "POST", json: { week: thisWeek(), ...json } });
    expect((await post({ kind: "brag" })).status).toBe(400);
    expect((await post({ kind: "home_dinners", text: "you all eat badly" })).status).toBe(201); // unknown fields are dropped, never stored
    expect(JSON.stringify((await list(ann)).mine)).not.toContain("badly");
    expect((await post({ kind: "new_plant" })).status).toBe(422);
    expect((await post({ kind: "new_plant", foodId: chicken })).status).toBe(422);
    expect((await post({ kind: "new_plant", foodId: "fdc:does-not-exist" })).status).toBe(422);
    expect((await post({ kind: "new_recipe", foodId: kale })).status).toBe(422);
    expect((await post({ kind: "new_recipe", week: "2020-W01" })).status).toBe(422);
    expect((await post({ kind: "new_recipe", week: "this week" })).status).toBe(400);
  });

  it("accepts this week and last week in every time zone", () => {
    // Monday in UTC, still Sunday in New York: last week there is W45, this week in Asia is W47.
    const weeks = acceptedWeeks(new Date("2026-11-16T02:00:00Z"));
    expect([...weeks].sort()).toEqual(["2026-W45", "2026-W46", "2026-W47"]);
    expect(acceptedWeeks(new Date("2026-11-12T12:00:00Z")).has("2026-W45")).toBe(true);
    expect(acceptedWeeks(new Date("2026-11-12T12:00:00Z")).has("2026-W44")).toBe(false);
  });

  it("tells the app which recipes are new and which are community copies", async () => {
    const [ann, ben] = await Promise.all([signIn(), signIn()]);
    const make = async (client: Client, title: string) => {
      const res = await client.request("/v1/recipes", {
        method: "POST",
        json: { title, servings: 1, ingredients: [{ id: uuid(), foodId: rice, quantity: 100, unit: "g", role: "ingredient" }] },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const annRecipe = await make(ann, "Ann's rice");
    expect((await ann.request(`/v1/recipes/${annRecipe}/community`, { method: "PUT", json: { includeMethod: false } })).status).toBe(200);
    const community = (await (await ben.request("/v1/community/home")).json()).trending.find((c: { title: string }) => c.title === "Ann's rice");
    const copy = ((await (await ben.request(`/v1/community/${community.communityId}/save`, { method: "POST" })).json()) as { recipeId: string }).recipeId;
    const own = await make(ben, "Ben's rice");

    const hints = await list(ben);
    expect(hints.communityCopyIds).toEqual([copy]);
    expect(hints.newRecipeIds).toEqual([own]);
    expect((await list(ann)).newRecipeIds).toEqual([annRecipe]);
  });

  it("answers 404 feature_disabled when switched off", async () => {
    const ann = await signIn();
    config.features.milestones = false;
    try {
      for (const [path, method] of [["/v1/milestones", "GET"], ["/v1/milestones", "POST"], [`/v1/milestones/${uuid()}/cheer`, "PUT"]] as const) {
        const res = await ann.request(path, { method, json: method === "GET" ? undefined : { kind: "home_dinners", week: thisWeek(), cheer: "well_done" } });
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe("feature_disabled");
      }
    } finally {
      config.features.milestones = true;
    }
  });

  it("needs a signed-in person", async () => {
    const { call } = await import("./helpers.ts");
    expect((await call("/v1/milestones")).status).toBe(401);
  });
});
