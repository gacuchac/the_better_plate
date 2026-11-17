import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  GroupDetailSchema,
  MealsToReviewSchema,
  MyGroupInvitesSchema,
  PRIVACY_NOTICE,
  PendingMemberCreatedSchema,
  SharedMealListSchema,
  SharedMealSchema,
  SyncBatchResponseSchema,
} from "@betterplate/contracts";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";
import { runMaintenance } from "../src/jobs.ts";
import { devOutbox } from "../src/lib/mailer.ts";
import { inviteEmail } from "../src/modules/invites.ts";
import { call, type Client, findFood, signIn } from "./helpers.ts";

const uuid = () => crypto.randomUUID();
const newEmail = () => `person-${uuid()}@example.test`;
let rice: string;
let broccoli: string;

beforeAll(async () => {
  rice = await findFood("Rice, white, long-grain, regular, enriched, cooked");
  broccoli = await findFood("Broccoli, raw");
});
afterAll(() => pool.end());

async function createGroup(owner: Client, name = "The Garcias", myName = "Mom") {
  const res = await owner.request("/v1/groups", { method: "POST", json: { name, myName } });
  expect(res.status).toBe(201);
  return GroupDetailSchema.parse(await res.json());
}

async function addByEmail(admin: Client, groupId: string, email: string, name = "Grandma", role: "admin" | "member" = "member") {
  return admin.request(`/v1/groups/${groupId}/pending`, { method: "POST", json: { email, name, role } });
}

async function checkInvites(client: Client) {
  const res = await client.request("/v1/me/group-invites", { method: "POST" });
  expect(res.status).toBe(200);
  return MyGroupInvitesSchema.parse(await res.json());
}
const myInvites = async (client: Client) => (await checkInvites(client)).invites;

async function consent(client: Client) {
  const res = await client.request("/v1/me/consent", { method: "POST", json: { noticeVersion: PRIVACY_NOTICE.version, adultConfirmed: true } });
  expect(res.status).toBe(201);
}

async function joinByEmail(client: Client, inviteId: string, myName: string) {
  return client.request(`/v1/me/group-invites/${inviteId}/join`, { method: "POST", json: { myName } });
}

async function linkInvite(admin: Client, groupId: string) {
  const res = await admin.request(`/v1/groups/${groupId}/invites`, { method: "POST", json: { role: "member" } });
  return ((await res.json()) as { id: string }).id;
}

async function joinByLink(client: Client, token: string, myName: string) {
  const res = await client.request(`/v1/invites/${token}/accept`, { method: "POST", json: { myName } });
  expect(res.status).toBe(200);
}

async function saveRecipe(client: Client, body: Record<string, unknown>) {
  const id = uuid();
  const res = await client.request("/v1/sync/batch", {
    method: "POST",
    json: { protocol: 1, operations: [{ opId: uuid(), type: "recipe.put", entityId: id, baseVersion: null, body: { description: "", method: "", ...body } }] },
  });
  const out = await res.json();
  expect(out.results?.[0]?.status, JSON.stringify(out)).toBe("applied");
  return id;
}

async function upload(client: Client, colour = "#d8c9a7") {
  const data = (await sharp({ create: { width: 64, height: 48, channels: 3, background: colour } }).jpeg().toBuffer()).toString("base64");
  const res = await client.request("/v1/images/upload", { method: "POST", json: { data, alt: "A bowl", rightsConfirmed: true } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; alt: string; kind: string; credit: null; generator: null };
}

async function share(admin: Client, groupId: string, body: Record<string, unknown>) {
  const res = await admin.request(`/v1/groups/${groupId}/meal-shares`, { method: "POST", json: body });
  expect(res.status).toBe(201);
  return SharedMealSchema.parse(await res.json());
}

async function meals(client: Client, groupId: string) {
  const res = await client.request(`/v1/groups/${groupId}/meal-shares`);
  expect(res.status).toBe(200);
  return SharedMealListSchema.parse(await res.json());
}

describe("adding people by email", () => {
  it("adds someone before they have an account; they join on first sign-in with a tap", async () => {
    const owner = await signIn();
    const g = await createGroup(owner);
    const email = newEmail();
    const res = await addByEmail(owner, g.id, email.toUpperCase(), "Grandma");
    expect(res.status).toBe(201);
    const created = PendingMemberCreatedSchema.parse(await res.json());
    expect(created.emailed).toBe(true);
    expect(created.group.pending).toEqual([expect.objectContaining({ email, name: "Grandma", role: "member", emailedAt: expect.any(String) })]);
    expect(created.group.members).toHaveLength(1);
    expect(created.group.features).toEqual({ emailInvites: true, mealShares: true, planning: true });

    // One invite email, naming the inviter and the group, with no admin-written text.
    const mail = devOutbox(email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe("Mom added you to The Garcias on The Better Plate");
    expect(mail[0]!.text).toContain(`sign in with this email address (${email})`);
    expect(mail[0]!.text).toContain("You'll be in the group as soon as you sign in, and you can leave it at any time.");

    // Adding the same email again is refused; resending too soon is refused.
    expect((await addByEmail(owner, g.id, email)).status).toBe(409);
    expect((await owner.request(`/v1/groups/${g.id}/pending/${created.group.pending[0]!.id}/resend`, { method: "POST" })).status).toBe(429);

    // First sign-in creates the account. Nothing joins before they agree to the privacy notice;
    // agreeing puts them in the group, with the name the admin gave them.
    const grandma = await signIn(email);
    expect(await myInvites(grandma)).toEqual([expect.objectContaining({ groupName: "The Garcias", invitedBy: "Mom", suggestedName: "Grandma", role: "member" })]);
    expect((await (await grandma.request("/v1/groups")).json()).groups).toEqual([]);
    await consent(grandma);
    const groups = (await (await grandma.request("/v1/groups")).json()).groups;
    expect(groups.map((x: { name: string; role: string }) => [x.name, x.role])).toEqual([["The Garcias", "member"]]);
    const detail = GroupDetailSchema.parse(await (await grandma.request(`/v1/groups/${g.id}`)).json());
    expect(detail.members.map((m) => [m.name, m.role])).toEqual([["Mom", "owner"], ["Grandma", "member"]]);
    expect(detail.pending).toEqual([]); // members never see pending people
    expect((await owner.request(`/v1/groups/${g.id}`).then((r) => r.json())).pending).toEqual([]);

    // Home says who added them until they dismiss it; leaving stays one tap away.
    const after = await checkInvites(grandma);
    expect(after.invites).toEqual([]);
    expect(after.joined).toEqual([{ groupId: g.id, groupName: "The Garcias", memberId: detail.members[1]!.id, invitedBy: "Mom" }]);
    expect((await grandma.request(`/v1/me/groups/${g.id}/welcome-seen`, { method: "POST" })).status).toBe(204);
    expect((await checkInvites(grandma)).joined).toEqual([]);
    expect((await grandma.request(`/v1/groups/${g.id}/members/${detail.members[1]!.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await (await grandma.request("/v1/groups")).json()).groups).toEqual([]);
  });

  it("joins an account that already agreed the next time it checks", async () => {
    const [owner, existing] = await Promise.all([signIn(), signIn()]);
    await consent(existing);
    const g = await createGroup(owner);
    expect((await addByEmail(owner, g.id, existing.email, "Uncle")).status).toBe(201);
    const out = await checkInvites(existing);
    expect(out.invites).toEqual([]);
    expect(out.joined.map((j) => [j.groupName, j.invitedBy])).toEqual([["The Garcias", "Mom"]]);
    // Checking again joins nothing twice.
    expect((await checkInvites(existing)).joined).toHaveLength(1);
    expect(GroupDetailSchema.parse(await (await owner.request(`/v1/groups/${g.id}`)).json()).members.map((m) => m.name)).toEqual(["Mom", "Uncle"]);
  });

  it("answers the same whether or not the email has an account, and matches only that verified email", async () => {
    const [owner, existing, stranger] = await Promise.all([signIn(), signIn(), signIn()]);
    const g = await createGroup(owner);
    const a = await addByEmail(owner, g.id, existing.email, "Uncle");
    const b = await addByEmail(owner, g.id, newEmail(), "Aunt");
    expect([a.status, b.status]).toEqual([201, 201]);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(Object.keys(ja).sort()).toEqual(Object.keys(jb).sort());
    expect(ja.emailed).toBe(jb.emailed);

    // The invited account sees it at its next sign-in; someone else can't see it or use its id.
    const mine = await myInvites(existing);
    expect(mine).toHaveLength(1);
    expect(await myInvites(stranger)).toEqual([]);
    expect((await joinByEmail(stranger, mine[0]!.id, "Me")).status).toBe(404);
    expect((await stranger.request(`/v1/me/group-invites/${mine[0]!.id}/decline`, { method: "POST" })).status).toBe(404);

    // Declining removes it from the group's waiting list.
    expect((await existing.request(`/v1/me/group-invites/${mine[0]!.id}/decline`, { method: "POST" })).status).toBe(204);
    const after = GroupDetailSchema.parse(await (await owner.request(`/v1/groups/${g.id}`)).json());
    expect(after.pending.map((p) => p.name)).toEqual(["Aunt"]);
  });

  it("lets only the owner add admins, admins add members, and members add no one", async () => {
    const [owner, admin, member] = await Promise.all([signIn(), signIn(), signIn()]);
    const g = await createGroup(owner);
    expect((await addByEmail(owner, g.id, admin.email, "Dad", "admin")).status).toBe(201);
    expect((await joinByEmail(admin, (await myInvites(admin))[0]!.id, "Dad")).status).toBe(200);
    await joinByLink(member, await linkInvite(owner, g.id), "Kid");
    const roles = GroupDetailSchema.parse(await (await owner.request(`/v1/groups/${g.id}`)).json()).members.map((m) => [m.name, m.role]);
    expect(roles).toEqual([["Mom", "owner"], ["Dad", "admin"], ["Kid", "member"]]);

    expect((await addByEmail(admin, g.id, newEmail(), "X", "admin")).status).toBe(403);
    expect((await addByEmail(admin, g.id, newEmail(), "X", "member")).status).toBe(201);
    expect((await addByEmail(member, g.id, newEmail(), "X", "member")).status).toBe(403);
    expect((await addByEmail(await signIn(), g.id, newEmail(), "X", "member")).status).toBe(404);
    // Members don't see who is waiting, or their emails.
    const seen = GroupDetailSchema.parse(await (await member.request(`/v1/groups/${g.id}`)).json());
    expect(seen.pending).toEqual([]);
    // Bad addresses are rejected.
    expect((await addByEmail(owner, g.id, "not-an-email", "X")).status).toBe(400);
    // Admins can take an invite back.
    const pendingId = GroupDetailSchema.parse(await (await owner.request(`/v1/groups/${g.id}`)).json()).pending[0]!.id;
    expect((await admin.request(`/v1/groups/${g.id}/pending/${pendingId}`, { method: "DELETE" })).status).toBe(204);
  });

  it("caps invite emails per person per day", async () => {
    const owner = await signIn();
    const groups = await Promise.all([createGroup(owner, "One"), createGroup(owner, "Two")]);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await addByEmail(owner, groups[i % 2]!.id, newEmail(), `P${i}`)).status);
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("keeps names people typed to one plain line in the email", () => {
    const mail = inviteEmail({ to: "a@example.test", inviter: "Mom\r\nBcc: x@evil.test", group: "Fam ily", appUrl: "https://app.example" });
    expect(mail.subject).toBe("Mom Bcc: x@evil.test added you to Fam ily on The Better Plate");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("forgets unused invites after they expire, and invites to a deleted account", async () => {
    const owner = await signIn();
    const g = await createGroup(owner);
    const email = newEmail();
    await addByEmail(owner, g.id, email);
    await pool.query("update group_pending_members set expires_at = now() - interval '1 minute' where email = $1", [email]);
    expect((await runMaintenance())?.expiredInvites).toBeGreaterThanOrEqual(1);
    expect((await pool.query("select 1 from group_pending_members where email = $1", [email])).rowCount).toBe(0);

    const leaving = await signIn();
    await addByEmail(owner, g.id, leaving.email);
    expect((await leaving.request("/v1/me", { method: "DELETE" })).status).toBe(204);
    expect((await pool.query("select 1 from group_pending_members where email = $1", [leaving.email.toLowerCase()])).rowCount).toBe(0);
  });

  it("answers 404 feature_disabled when switched off", async () => {
    const owner = await signIn();
    const g = await createGroup(owner);
    config.features.groupEmailInvites = false;
    try {
      const res = await addByEmail(owner, g.id, newEmail());
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("feature_disabled");
      expect((await owner.request("/v1/me/group-invites", { method: "POST" })).status).toBe(404);
      expect(GroupDetailSchema.parse(await (await owner.request(`/v1/groups/${g.id}`)).json()).features.emailInvites).toBe(false);
    } finally {
      config.features.groupEmailInvites = true;
    }
  });
});

describe("shared meals", () => {
  async function family() {
    const [owner, admin, member] = await Promise.all([signIn(), signIn(), signIn()]);
    const g = await createGroup(owner);
    await joinByLink(member, await linkInvite(owner, g.id), "Kid");
    const adminLink = await owner.request(`/v1/groups/${g.id}/invites`, { method: "POST", json: { role: "admin" } }).then((r) => r.json());
    await joinByLink(admin, adminLink.id, "Dad");
    return { owner, admin, member, g };
  }

  it("shares a simplified card: title, short description, photo and nutrients, never the recipe", async () => {
    const { owner, admin, member, g } = await family();
    const photo = await upload(owner);
    const recipeId = await saveRecipe(owner, {
      title: "Rice bowl", servings: 2, description: "A quick weeknight bowl.", method: "SECRET METHOD steps",
      image: { ...photo, alt: "Rice bowl in a blue dish" },
      ingredients: [{ id: uuid(), foodId: rice, quantity: 300, unit: "g", role: "ingredient" }, { id: uuid(), foodId: broccoli, quantity: 200, unit: "g", role: "ingredient" }],
    });
    const meal = await share(owner, g.id, { recipeId });
    expect(meal).toMatchObject({ title: "Rice bowl", summary: "A quick weeknight bowl.", sharedBy: "Mom", myReaction: null, reactions: [] });
    expect(meal.nutrients.map((n) => n.key)).toEqual(["energy_kcal", "protein", "carbohydrate", "fat_total", "fiber", "sugars_total", "sodium"]);
    expect(meal.nutrients[0]).toMatchObject({ name: expect.any(String), unit: "kcal", amount: expect.any(Number) });
    expect(meal.image).toMatchObject({ alt: "Rice bowl in a blue dish", kind: "upload" });
    // Only the recipe's owner gets a way to the full recipe; another admin gets the id for planning only.
    expect(meal.myRecipeId).toBe(recipeId);
    const dads = (await meals(admin, g.id)).meals[0]!;
    expect(dads).toMatchObject({ recipeId, myRecipeId: null });

    // A member sees the same card, with no recipe fields and no one else's reactions.
    const seen = (await meals(member, g.id)).meals[0]!;
    expect(seen).toMatchObject({ reactions: null, recipeId: null, myRecipeId: null });
    const raw = JSON.stringify(await (await member.request(`/v1/groups/${g.id}/meal-shares`)).json());
    expect(raw).not.toMatch(/SECRET METHOD|ingredients|foodId|created_by|"recipeId":"/);
    expect(raw).not.toContain(rice);

    // The photo is served to people in the group only.
    expect((await member.request(new URL(seen.image!.url).pathname)).status).toBe(200);
    expect((await (await signIn()).request(new URL(seen.image!.url).pathname)).status).toBe(404);

    // Later recipe edits (even removing its photo) don't change the shared card, and the photo survives cleanup.
    await pool.query("update recipe_images set created_at = now() - interval '30 days' where id = $1", [photo.id]);
    const res = await owner.request("/v1/sync/batch", {
      method: "POST",
      json: { protocol: 1, operations: [{ opId: uuid(), type: "recipe.put", entityId: recipeId, baseVersion: 1, body: { title: "Renamed", servings: 2, description: "", method: "", image: null, ingredients: [{ id: uuid(), foodId: rice, quantity: 100, unit: "g", role: "ingredient" }] } }] },
    });
    expect(SyncBatchResponseSchema.parse(await res.json()).results[0]!.status).toBe("applied");
    await runMaintenance();
    const again = (await meals(member, g.id)).meals[0]!;
    expect(again.title).toBe("Rice bowl");
    expect(again.nutrients).toEqual(seen.nutrients);
    expect((await member.request(new URL(again.image!.url).pathname)).status).toBe(200);

    // Once the owner deletes the recipe, the card stays but no longer leads anywhere.
    await pool.query("update recipes set deleted_at = now() where id = $1", [recipeId]);
    expect((await meals(owner, g.id)).meals[0]!.myRecipeId).toBeNull();
  });

  it("uses the admin's text and photo choices, and shows no photo when there is none", async () => {
    const { owner, admin, g } = await family();
    const plain = await saveRecipe(owner, { title: "Soup", servings: 4, description: "", ingredients: [{ id: uuid(), foodId: broccoli, quantity: 400, unit: "g", role: "ingredient" }] });
    const noPhoto = await share(owner, g.id, { recipeId: plain, summary: "  Warm and green.  " });
    expect(noPhoto).toMatchObject({ summary: "Warm and green.", image: null });

    // An admin may use their own photo, but not someone else's that isn't on the recipe.
    const mine = await upload(admin, "#335533");
    const others = await upload(owner, "#553333");
    const changed = await admin.request(`/v1/groups/${g.id}/meal-shares/${noPhoto.id}`, { method: "PUT", json: { imageId: mine.id } });
    expect(changed.status).toBe(200);
    expect(SharedMealSchema.parse(await changed.json()).image).toMatchObject({ kind: "upload" });
    expect((await admin.request(`/v1/groups/${g.id}/meal-shares/${noPhoto.id}`, { method: "PUT", json: { imageId: others.id } })).status).toBe(422);
    const removed = await admin.request(`/v1/groups/${g.id}/meal-shares/${noPhoto.id}`, { method: "PUT", json: { imageId: null, summary: "New words" } });
    expect(SharedMealSchema.parse(await removed.json())).toMatchObject({ image: null, summary: "New words" });

    // Sharing without a photo even when the recipe has one.
    const withPhoto = await saveRecipe(owner, { title: "Bowl", servings: 1, image: { ...others, alt: "Bowl" }, ingredients: [{ id: uuid(), foodId: rice, quantity: 200, unit: "g", role: "ingredient" }] });
    expect((await share(owner, g.id, { recipeId: withPhoto, imageId: null })).image).toBeNull();
  });

  it("lets each person like or pass with a comment; only admins see everyone's", async () => {
    const { owner, admin, member, g } = await family();
    const recipeId = await saveRecipe(owner, { title: "Tacos", servings: 2, ingredients: [{ id: uuid(), foodId: rice, quantity: 200, unit: "g", role: "ingredient" }] });
    const meal = await share(owner, g.id, { recipeId });

    // Waiting for the member's reaction, not the sharer's.
    expect(MealsToReviewSchema.parse(await (await member.request("/v1/me/meals-to-review")).json()).groups).toEqual([{ groupId: g.id, groupName: "The Garcias", count: 1 }]);
    expect(MealsToReviewSchema.parse(await (await owner.request("/v1/me/meals-to-review")).json()).groups).toEqual([]);

    const react = (c: Client, body: Record<string, unknown>) => c.request(`/v1/groups/${g.id}/meal-shares/${meal.id}/reaction`, { method: "PUT", json: body });
    expect((await react(member, { reaction: "dislike", comment: "Too spicy for me" })).status).toBe(200);
    const replaced = SharedMealSchema.parse(await (await react(member, { reaction: "like" })).json());
    expect(replaced.myReaction).toEqual({ reaction: "like", comment: "" });
    expect(replaced.reactions).toBeNull();
    expect((await react(admin, { reaction: "dislike", comment: "Not again this week" })).status).toBe(200);
    expect((await react(member, { reaction: "meh" })).status).toBe(400);
    expect((await react(member, { reaction: "like", comment: "x".repeat(281) })).status).toBe(400);
    expect((await react(await signIn(), { reaction: "like" })).status).toBe(404);

    expect(MealsToReviewSchema.parse(await (await member.request("/v1/me/meals-to-review")).json()).groups).toEqual([]);

    const ownerView = (await meals(owner, g.id)).meals[0]!;
    expect(ownerView.reactions!.map((r) => [r.name, r.reaction, r.comment])).toEqual([["Kid", "like", ""], ["Dad", "dislike", "Not again this week"]]);
    const memberView = (await meals(member, g.id)).meals[0]!;
    expect(memberView.reactions).toBeNull();
    expect(JSON.stringify(memberView)).not.toContain("Not again this week");

    // An admin clears a comment; the reaction stays.
    const dad = ownerView.reactions!.find((r) => r.name === "Dad")!;
    expect((await member.request(`/v1/groups/${g.id}/meal-shares/${meal.id}/reactions/${dad.memberId}/comment`, { method: "DELETE" })).status).toBe(403);
    expect((await owner.request(`/v1/groups/${g.id}/meal-shares/${meal.id}/reactions/${dad.memberId}/comment`, { method: "DELETE" })).status).toBe(204);
    expect((await meals(owner, g.id)).meals[0]!.reactions!.find((r) => r.name === "Dad")).toMatchObject({ reaction: "dislike", comment: "" });

    // Exports carry the share and the reaction.
    const exported = await (await member.request("/v1/me/export")).json();
    expect(exported.groupMealReactions).toEqual([expect.objectContaining({ shareId: meal.id, reaction: "like", title: "Tacos" })]);
    expect((await (await owner.request("/v1/me/export")).json()).groupMealShares).toEqual([expect.objectContaining({ shareId: meal.id, title: "Tacos" })]);

    // Leaving the group deletes your reactions there; withdrawing deletes the share.
    const kid = ownerView.reactions!.find((r) => r.name === "Kid")!;
    expect((await member.request(`/v1/groups/${g.id}/members/${kid.memberId}`, { method: "DELETE" })).status).toBe(204);
    expect((await meals(owner, g.id)).meals[0]!.reactions!.map((r) => r.name)).toEqual(["Dad"]);
    expect((await member.request(`/v1/groups/${g.id}/meal-shares`)).status).toBe(404);
    expect((await admin.request(`/v1/groups/${g.id}/meal-shares/${meal.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await meals(owner, g.id)).meals).toEqual([]);
  });

  it("lets only admins share, from their own or the group's recipes with an estimate", async () => {
    const { owner, admin, member, g } = await family();
    const ownersRecipe = await saveRecipe(owner, { title: "Mine", servings: 1, ingredients: [{ id: uuid(), foodId: rice, quantity: 100, unit: "g", role: "ingredient" }] });
    expect((await member.request(`/v1/groups/${g.id}/meal-shares`, { method: "POST", json: { recipeId: ownersRecipe } })).status).toBe(403);
    // Another admin can't share the owner's private recipe...
    expect((await admin.request(`/v1/groups/${g.id}/meal-shares`, { method: "POST", json: { recipeId: ownersRecipe } })).status).toBe(404);
    // ...but can once it is a group recipe.
    expect((await owner.request(`/v1/groups/${g.id}/recipes`, { method: "POST", json: { recipeId: ownersRecipe } })).status).toBe(201);
    const groupRecipeId = ((await (await owner.request(`/v1/groups/${g.id}/recipes`)).json()).recipes as { id: string }[])[0]!.id;
    expect((await admin.request(`/v1/groups/${g.id}/meal-shares`, { method: "POST", json: { recipeId: groupRecipeId } })).status).toBe(201);
    expect((await owner.request(`/v1/groups/${g.id}/meal-shares`, { method: "POST", json: { recipeId: uuid() } })).status).toBe(404);
  });

  it("pages newest first", async () => {
    const { owner, g } = await family();
    const recipeId = await saveRecipe(owner, { title: "Base", servings: 1, ingredients: [{ id: uuid(), foodId: rice, quantity: 100, unit: "g", role: "ingredient" }] });
    for (let i = 0; i < 22; i++) await share(owner, g.id, { recipeId, summary: `n${i}` });
    const first = await meals(owner, g.id);
    expect(first.meals).toHaveLength(20);
    expect(first.meals[0]!.summary).toBe("n21");
    const second = SharedMealListSchema.parse(await (await owner.request(`/v1/groups/${g.id}/meal-shares?cursor=${first.nextCursor}`)).json());
    expect(second.meals.map((m) => m.summary)).toEqual(["n1", "n0"]);
    expect(second.nextCursor).toBeNull();
    expect((await owner.request(`/v1/groups/${g.id}/meal-shares?cursor=junk`)).status).toBe(400);
  });

  it("answers 404 feature_disabled when switched off", async () => {
    const { owner, g } = await family();
    config.features.groupMealShares = false;
    try {
      for (const path of [`/v1/groups/${g.id}/meal-shares`, "/v1/me/meals-to-review"]) {
        const res = await owner.request(path);
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe("feature_disabled");
      }
    } finally {
      config.features.groupMealShares = true;
    }
  });

  it("needs sign-in", async () => {
    expect((await call(`/v1/me/meals-to-review`)).status).toBe(401);
    expect((await call(`/v1/me/group-invites`, { method: "POST" })).status).toBe(401);
  });
});
