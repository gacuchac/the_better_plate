import type { Native, ProviderTurn, TurnArgs } from "./providers.ts";

/**
 * Scripted stand-in for a model, for local runs and automated tests only (never in dev or
 * production, see adapterFor). It drives the real tool loop so journeys exercise the app.
 */
export const isFakeKey = (apiKey: string) => apiKey.startsWith("fake-local-");

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string };

function lastUserText(conversation: Native[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const m = conversation[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/** Tool results since the person's last message, oldest first. */
function resultsSinceUser(conversation: Native[]): { name: string; output: unknown }[] {
  const names = new Map<string, string>();
  const out: { name: string; output: unknown }[] = [];
  for (const m of conversation) {
    if (m.role === "user" && typeof m.content === "string") out.length = 0;
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Block[]) {
      if (b.type === "tool_use") names.set(b.id!, b.name!);
      if (b.type === "tool_result") {
        let output: unknown = b.content;
        try {
          output = JSON.parse(b.content ?? "");
        } catch {
          // plain text result
        }
        out.push({ name: names.get(b.tool_use_id!) ?? "?", output });
      }
    }
  }
  return out;
}

let seq = 0;
const call = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_fake_${++seq}`, name, input });

function plan(message: string, done: { name: string; output: unknown }[]): Block[] {
  const step = done.length;
  // Keywords come from what the person typed, not from the app context appended to it.
  const text = message.replace(/<app_context>[\s\S]*<\/app_context>/, "");
  const last = done.at(-1)?.output as Record<string, unknown> | undefined;
  // The device's date from the app context, so "today" matches the person's time zone.
  const today = /"today":"(\d{4}-\d{2}-\d{2})"/.exec(message)?.[1] ?? new Date().toISOString().slice(0, 10);

  if (/recipe|receta/i.test(text)) {
    if (step === 0) return [{ type: "text", text: "Let me find chicken in your foods." }, call("search_foods", { query: "chicken breast raw" })];
    if (step === 1) {
      const food = (last?.foods as { id: string }[] | undefined)?.[0];
      if (!food) return [{ type: "text", text: "I couldn't find chicken on this device." }];
      return [
        call("save_recipe", {
          title: "Companion lemon chicken",
          servings: 2,
          ingredients: [{ foodId: food.id, grams: 300 }],
          method: "1. Pat the chicken dry.\n2. Cook until it reaches 165°F (74°C) inside.",
        }),
      ];
    }
    if (step === 2) return [call("navigate", { screen: "recipe", recipeId: last?.recipeId })];
    if (step === 3) return [call("get_recipe", { recipeId: (done[1]!.output as { recipeId: string }).recipeId })];
    const protein = ((last?.estimatedPerServing as { key: string; amount: number | null }[] | undefined) ?? []).find((n) => n.key === "protein");
    return [{ type: "text", text: `I saved "Companion lemon chicken" for 2 servings. The app estimates ${protein?.amount ?? "?"} g of protein per serving.` }];
  }

  if (/\bate\b|comí/i.test(text)) {
    if (step === 0) return [call("list_recipes", {})];
    if (step === 1) {
      const recipe = (last?.recipes as { id: string }[] | undefined)?.[0];
      if (!recipe) return [{ type: "text", text: "You have no recipes yet." }];
      return [call("log_meal", { recipeId: recipe.id, date: today, slot: "lunch", servings: 1 })];
    }
    if (step === 2) return [call("navigate", { screen: "meals", date: today })];
    return [{ type: "text", text: "Logged one serving as eaten for lunch today." }];
  }

  if (/delete|borra/i.test(text)) {
    if (step === 0) return [call("list_recipes", {})];
    if (step === 1) {
      const recipe = (last?.recipes as { id: string }[] | undefined)?.[0];
      if (!recipe) return [{ type: "text", text: "You have no recipes to delete." }];
      return [call("delete_recipe", { recipeId: recipe.id })];
    }
    return [{ type: "text", text: (last as { declined?: boolean } | undefined)?.declined ? "Okay, I kept it." : "Deleted." }];
  }

  if (/invalid tool/i.test(text) && step === 0) return [call("save_recipe", { title: "", servings: -1, ingredients: [{ foodId: "made-up", grams: 10 }] }), call("drop_database", {})];

  return [{ type: "text", text: "I can build recipes, plan or log meals and find foods for you." }];
}

export async function fakeTurn({ conversation, input }: TurnArgs): Promise<ProviderTurn> {
  const next: Native =
    input.type === "message"
      ? { role: "user", content: input.text }
      : { role: "user", content: input.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output, is_error: r.isError })) };
  const messages = [...conversation, next];
  const blocks = plan(lastUserText(messages), resultsSinceUser(messages));
  return {
    conversation: [...messages, { role: "assistant", content: blocks }],
    text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, input: b.input })),
    model: "fake-companion",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
