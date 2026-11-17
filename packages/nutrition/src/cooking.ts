/**
 * Cook it: turns a person's own method text into a checklist and names the technique each step
 * uses. Everything is worked out from their words with fixed keyword lists (English and Spanish);
 * nothing is generated and no step is added. Technique explanations say what the technique is,
 * never a time, temperature or safety claim; safe temperatures come only from safety.ts.
 */
import { SAFETY_RULES, type SafetyRule } from "./safety.ts";

export interface Technique {
  id: string;
  /** English name; other languages come from the app's strings. */
  label: string;
  /** What you're doing, in plain words. */
  what: string;
  /** Applies heat to the food (used to decide when to show a safe-temperature reminder). */
  heat: boolean;
  /** Word starts, accent-free and lower case; "~" marks a whole word. */
  words: string[];
}

const T = (id: string, label: string, what: string, heat: boolean, words: string[]): Technique => ({ id, label, what, heat, words });

/** Order matters only for ties: the longer keyword at the same place wins. */
export const TECHNIQUES: Technique[] = [
  T("preheat", "Preheat", "Heat the oven, pan or grill before the food goes in, so it cooks evenly from the start.", false, ["preheat", "pre-heat", "precalent"]),
  T("rinse", "Rinse or drain", "Wash under running water, or pour off the liquid.", false, ["rinse", "~wash", "drain", "enjuag", "~lava", "~lavar", "escurr"]),
  T("peel", "Peel", "Take off the skin or outer layer.", false, ["peel", "~pela", "~pelar", "~pelad"]),
  T("chop", "Chop", "Cut into pieces: diced means small cubes, minced means very fine bits.", false, ["chop", "dice", "~diced", "mince", "cube", "~cut", "~pica", "~picar", "~picad", "~corta", "~cortar", "~cortad", "trocea", "~trocear"]),
  T("slice", "Slice", "Cut into thin, even pieces.", false, ["slice", "rebana", "rodaja", "~filetea"]),
  T("grate", "Grate", "Rub against a grater for fine shreds or zest.", false, ["grate", "shred", "~zest", "ralla", "~rallar"]),
  T("marinate", "Marinate", "Leave the food in a seasoned liquid so it takes on flavor.", false, ["marinat", "marinad", "~marina", "~marinar", "adoba"]),
  T("season", "Season", "Add salt, pepper, herbs or spices for flavor.", false, ["season", "sazon", "salpiment", "condimenta"]),
  T("grease", "Grease", "Coat the pan or tray with a little fat so nothing sticks.", false, ["grease", "~spray", "engrasa", "unta el molde", "aceita el molde"]),
  T("mix", "Mix", "Stir ingredients together so they combine evenly.", false, ["~mix", "~stir", "combine", "~toss", "mezcl", "revuelv", "remuev", "combina", "incorpora"]),
  T("whisk", "Whisk", "Beat quickly with a whisk or fork to blend and add air.", false, ["whisk", "~beat", "~whip", "~bate", "~batir", "~batid", "~bata"]),
  T("fold", "Fold", "Gently lift and turn the mixture to combine it without knocking out the air.", false, ["~fold", "envuelv", "envolver"]),
  T("knead", "Knead", "Press, fold and turn dough by hand until it's smooth and springy.", false, ["knead", "~amasa", "~amasar"]),
  T("blend", "Blend", "Blend until smooth with a blender, stick blender or food processor.", false, ["blend", "puree", "licua", "licuar", "tritura", "procesa"]),
  T("mash", "Mash", "Crush soft cooked food into a smooth or chunky mash.", false, ["~mash", "machaca", "aplasta", "pisa", "haz pure"]),
  T("preheat_pan", "Heat the pan", "Warm the pan and fat first so food starts cooking as soon as it goes in.", true, ["heat the oil", "heat oil", "heat the pan", "heat a pan", "heat a skillet", "heat the skillet", "calienta el aceite", "calienta la sarten", "calienta una sarten"]),
  T("sear", "Sear", "Cook the surface over high heat until browned, which builds flavor.", true, ["~sear", "~brown", "~dora", "~dorar", "~doralo", "~dorala", "~dore", "sella", "sellar"]),
  T("saute", "Sauté", "Cook in a little fat over medium to high heat, stirring often.", true, ["saute", "sofrie", "sofreir", "sofrito", "saltea"]),
  T("stir_fry", "Stir-fry", "Cook small pieces fast over very high heat, tossing constantly.", true, ["stir-fry", "stir fry", "stir-fried", "~wok"]),
  T("deep_fry", "Deep-fry", "Cook fully submerged in hot oil.", true, ["deep-fr", "deep fr", "abundante aceite"]),
  T("air_fry", "Air-fry", "Cook in an air fryer, where fast hot air crisps the outside.", true, ["air-fr", "air fr", "freidora de aire"]),
  T("pan_fry", "Pan-fry", "Cook in a shallow layer of hot fat, turning once.", true, ["pan-fr", "pan fr", "~fry", "~fried", "~frying", "~frie", "~freir", "~frit"]),
  T("caramelize", "Caramelize", "Cook slowly until the natural sugars turn golden brown and sweet.", true, ["carameli"]),
  T("wilt", "Wilt", "Cook leafy greens briefly until they soften and shrink.", true, ["~wilt", "marchit"]),
  T("toast", "Toast", "Heat dry until golden and fragrant.", true, ["toast", "~tuesta", "~tostar", "~tostad"]),
  T("bake", "Bake", "Cook in the oven with dry, surrounding heat.", true, ["~bake", "~baking", "~baked", "hornea", "~hornear", "al horno"]),
  T("roast", "Roast", "Cook in a hot oven until browned on the outside.", true, ["roast", "~asa", "~asar", "~asalo", "~asala", "rostiz"]),
  T("grill", "Grill", "Cook over or under direct high heat for char marks.", true, ["grill", "broil", "barbecu", "~bbq", "~char", "parrill", "plancha", "gratina"]),
  T("boil", "Boil", "Cook in water at a full, rolling bubble.", true, ["~boil", "hierv", "~hervir", "ebullicion"]),
  T("simmer", "Simmer", "Cook in liquid at a gentle bubble, below a full boil.", true, ["simmer", "fuego lento", "fuego bajo", "fuego suave"]),
  T("blanch", "Blanch", "Boil briefly, then cool quickly to stop the cooking.", true, ["blanch", "escalda", "blanquea"]),
  T("steam", "Steam", "Cook over boiling water, not in it.", true, ["steam", "al vapor", "~vapor"]),
  T("poach", "Poach", "Cook gently in liquid that's barely moving.", true, ["poach", "escalfa", "pocha"]),
  T("braise", "Braise", "Brown, then cook slowly covered in a little liquid until tender.", true, ["braise", "braising", "~stew", "estofa", "guisa", "~brasea"]),
  T("pressure_cook", "Pressure-cook", "Cook sealed under pressure, which is much faster than a pot.", true, ["pressure cook", "pressure-cook", "instant pot", "olla a presion", "olla express"]),
  T("slow_cook", "Slow-cook", "Cook for hours at low heat in a slow cooker.", true, ["slow cook", "slow-cook", "crockpot", "crock-pot", "crock pot", "olla de coccion lenta", "olla lenta"]),
  T("microwave", "Microwave", "Heat in the microwave.", true, ["microwav", "microondas"]),
  T("reduce", "Reduce", "Simmer a liquid uncovered so some water cooks off and it thickens.", true, ["~reduce until", "~reduce by", "~reduce the sauce", "~reduce the liquid", "~reduce a", "~reducir", "reduce la salsa", "reduce el liquido"]),
  T("rest", "Rest", "Leave it off the heat for a few minutes so juices settle and it finishes gently.", false, ["~rest", "repos"]),
  T("chill", "Chill", "Cool it down in the fridge or freezer.", false, ["~chill", "refrigerat", "~freeze", "enfria", "refrigera", "congela"]),
  T("assemble", "Assemble", "Put the parts together: fill, layer or spread.", false, ["assemble", "~fill", "~arma", "~armar", "rellena"]),
  T("serve", "Serve", "Plate it up and add any final touches.", false, ["~serve", "~plate", "garnish", "~sirve", "~servir", "emplata", "decora"]),
];

const byId = new Map(TECHNIQUES.map((t) => [t.id, t]));
export const techniqueById = (id: string) => byId.get(id) ?? null;

/** Lower case, no accents, so "Dórala" and "dorala" match the same keyword. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Phrases that name an ingredient or a setting, not something you do. */
const NOT_TECHNIQUES = /baking (powder|soda)|polvo de hornear|bicarbonato|reduce (the )?heat|reduced[- ]sodium|reduce el fuego|the rest of|el resto|brown (rice|sugar|lentils|bread)|(pork|lamb|veal) chops|(?:ground|crushed|black|white) pepper|cut[- ]up chicken/g;

/** Endings a whole-word keyword may take: stir → stirs, stirred, stirring; corta → cortalo, cortado. */
const ENDING = /^(?:s|es|ed|ing|en|n|[a-z](?:ed|ing)|lo|la|los|las|o|a|os|as|do|da|dos|das)?(?![\p{L}\p{N}])/u;

/**
 * "Add the diced onion" or "con cebolla picada" describe an ingredient that's already prepared,
 * not a step to do now: a past participle counts only where an instruction would start.
 */
function describesIngredient(text: string, at: number): boolean {
  const word = /^[\p{L}-]+/u.exec(text.slice(at))?.[0] ?? "";
  if (!/(ed|ados?|adas?|idos?|idas?)$/.test(word)) return false;
  const before = text.slice(0, at).trimEnd();
  return !(before === "" || /[.;:,!?]$/.test(before) || /(^|\s)(then|and|y|luego|despues)$/.test(before));
}

const isLetter = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Techniques the step names, in the order they appear, at most `limit`. */
export function findTechniques(step: string, limit = 3): Technique[] {
  const text = fold(step).replace(NOT_TECHNIQUES, (m) => " ".repeat(m.length));
  const hits: { at: number; len: number; t: Technique }[] = [];
  for (const t of TECHNIQUES) {
    let best: { at: number; len: number } | null = null;
    for (const raw of t.words) {
      const whole = raw.startsWith("~");
      const word = whole ? raw.slice(1) : raw;
      let from = 0;
      for (;;) {
        const at = text.indexOf(word, from);
        if (at < 0) break;
        from = at + 1;
        if (isLetter(text[at - 1])) continue;
        // "~" keywords must end at a word boundary unless they end with a space or punctuation.
        if (whole && /[\p{L}]$/u.test(word)) {
          const next = text.slice(at + word.length);
          if (!ENDING.test(next) && !(word.endsWith("e") && /^d(?![\p{L}\p{N}])/u.test(next))) continue;
        }
        if (describesIngredient(text, at)) continue;
        if (!best || at < best.at || (at === best.at && word.length > best.len)) best = { at, len: word.length };
        break;
      }
    }
    if (best) hits.push({ ...best, t });
  }
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  // Two techniques found at the same words (stir-fry also matches fry): keep the longer one.
  const kept: typeof hits = [];
  for (const h of hits) {
    if (kept.some((k) => h.at < k.at + k.len && k.at < h.at + h.len)) continue;
    kept.push(h);
  }
  return kept.slice(0, limit).map((h) => h.t);
}

export interface CookStep {
  /** The step in the person's words, without a leading "Label:". */
  text: string;
  /** A short heading the person wrote ("Rice:" → "Rice"), or null. */
  label: string | null;
  techniques: Technique[];
}

const NUMBERED = /^(\d+[.)]|[-*•])\s+/;
/** Sentence ends: punctuation followed by a capital, an opening mark or a digit-free bracket. */
const SENTENCE = /(?<=[.!?])\s+(?=[\p{Lu}¿¡(])/u;

function labelled(raw: string): { text: string; label: string | null } {
  const m = /^([^:.\d][^:.]{0,28}):\s+(\S.*)$/su.exec(raw);
  if (m && m[1]!.trim().split(/\s+/).length <= 4) return { label: m[1]!.trim(), text: m[2]!.trim() };
  return { label: null, text: raw };
}

function toStep(raw: string): CookStep {
  const { text, label } = labelled(raw);
  const techniques = findTechniques(label ? `${label}: ${text}` : text);
  return { text, label, techniques };
}

/**
 * Splits a method into an intro (text before a numbered list, such as a description) and steps.
 * Numbered or bulleted lines are steps; otherwise each line or paragraph is a step; a method
 * written as one paragraph is split into its sentences.
 */
export function cookSteps(method: string): { intro: string[]; steps: CookStep[] } {
  const lines = method.split(/\r?\n/).map((l) => l.trim());
  const numbered = lines.filter((l) => NUMBERED.test(l));
  if (numbered.length >= 2) {
    const intro: string[] = [];
    const steps: string[] = [];
    for (const l of lines) {
      if (!l) continue;
      if (NUMBERED.test(l)) steps.push(l.replace(NUMBERED, ""));
      else if (steps.length) steps[steps.length - 1] += ` ${l}`;
      else intro.push(l.replace(/^(description|descripci[oó]n)\s*:\s*/i, ""));
    }
    return { intro, steps: steps.map(toStep) };
  }
  let blocks = method
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (blocks.length === 1) blocks = blocks[0]!.split(SENTENCE).map((s) => s.trim()).filter(Boolean);
  return { intro: [], steps: blocks.map(toStep) };
}

/** Words that tie a step to a safe-temperature chart group (English and Spanish, accent-free). */
const RULE_WORDS: Record<string, string[]> = {
  poultry: ["chicken", "turkey", "poultry", "duck", "thigh", "breast", "drumstick", "wing", "pollo", "pavo", "muslo", "pechuga", "alita"],
  whole_cuts: ["beef", "steak", "ribeye", "sirloin", "pork", "lamb", "veal", "goat", "chops", "tenderloin", "bistec", "filete", "cerdo", "cordero", "ternera", "lomo", "carne"],
  ground_meat: ["ground", "meatball", "burger", "patty", "patties", "sausage", "molida", "albondiga", "hamburguesa", "salchicha", "chorizo"],
  game: ["rabbit", "venison", "deer", "conejo", "venado"],
  fish: ["fish", "salmon", "tuna", "cod", "tilapia", "trout", "halibut", "fillet", "pescado", "salmon", "atun", "merluza", "trucha"],
  crustaceans: ["shrimp", "prawn", "lobster", "crab", "scallop", "camaron", "langosta", "cangrejo", "vieira"],
  bivalves: ["clam", "oyster", "mussel", "almeja", "ostra", "mejillon"],
  eggs: ["egg", "huevo", "frittata", "quiche", "omelet"],
};

/**
 * Chart groups (from the recipe's own ingredients) that a heated step is cooking, so the app can
 * remind the person of that group's safe minimum temperature at that step.
 */
export function stepSafetyRules(step: CookStep, recipeRules: SafetyRule[]): SafetyRule[] {
  if (!step.techniques.some((t) => t.heat)) return [];
  const text = fold(`${step.label ?? ""} ${step.text}`);
  return recipeRules.filter((rule) =>
    (RULE_WORDS[rule.id] ?? []).some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?:s|es)?(?![\\p{L}\\p{N}])`, "u").test(text)),
  );
}

/** Every chart group has reminder words. */
export const SAFETY_RULE_IDS_WITH_WORDS = Object.keys(SAFETY_RULES).filter((id) => RULE_WORDS[id]);

/** A short fingerprint of the steps, so saved progress resets when the method changes. */
export function stepsFingerprint(steps: { text: string }[]): string {
  let h = 5381;
  for (const c of steps.map((s) => s.text).join("\n")) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
