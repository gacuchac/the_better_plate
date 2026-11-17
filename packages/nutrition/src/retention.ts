/**
 * Cooking losses (ADR-014). Recipes weigh ingredients raw. When a recipe cooks an ingredient, the
 * vitamins and minerals left are the raw amounts times USDA's nutrient retention factor for that
 * kind of food and cooking method (USDA Table of Nutrient Retention Factors, Release 6). Energy,
 * macronutrients, fiber, sugars and cholesterol have no USDA retention factors and are not changed.
 *
 * The only judgement here is which USDA cooking code fits a food and method; every percentage
 * comes from USDA (retention-data.ts is generated from the imported file).
 */
import { RETENTION_FACTORS } from "./retention-data.ts";
import type { FoodRecord } from "./types.ts";

export const COOKING_METHODS = [
  "boiled", "simmered", "braised", "slow_cooked", "pressure_cooked", "steamed", "blanched", "poached", "microwaved",
  "baked", "roasted", "grilled", "pan_fried", "sauteed", "stir_fried", "deep_fried", "air_fried",
] as const;
export type CookingMethod = (typeof COOKING_METHODS)[number];

/** Nutrients USDA publishes retention factors for, among those the app tracks. */
export const RETENTION_NUTRIENTS = ["calcium", "iron", "magnesium", "potassium", "sodium", "zinc", "vitamin_c", "vitamin_b12", "folate_dfe", "vitamin_a_rae"] as const;

type M = Partial<Record<CookingMethod, number>>;

/** Fills a method table from groups of methods that share a USDA code. */
function table(parts: {
  drained?: number; // boiled, blanched: water poured off
  liquid?: number; // simmered, braised, slow_cooked, pressure_cooked: the liquid is eaten
  steam?: number; // steamed, microwaved
  poach?: number;
  dry?: number; // baked, roasted, air_fried
  grill?: number;
  fat?: number; // pan_fried, sauteed, stir_fried
  deep?: number;
  only?: M;
}): M {
  const t: M = {};
  const set = (methods: CookingMethod[], code: number | undefined) => {
    if (code !== undefined) for (const m of methods) t[m] = code;
  };
  set(["boiled", "blanched"], parts.drained);
  set(["simmered", "braised", "slow_cooked", "pressure_cooked"], parts.liquid);
  set(["steamed", "microwaved"], parts.steam);
  set(["poached"], parts.poach ?? parts.liquid);
  set(["baked", "roasted", "air_fried"], parts.dry);
  set(["grilled"], parts.grill ?? parts.dry);
  set(["pan_fried", "sauteed", "stir_fried"], parts.fat);
  set(["deep_fried"], parts.deep ?? parts.fat);
  return { ...t, ...parts.only };
}

interface Group {
  methods: M;
  /** Code for a food that is already cooked (or canned) and is heated again. */
  reheated: number;
  /** Codes for frozen vegetables cooked in water or steam. */
  frozen?: number;
}

/**
 * Food group -> USDA cooking codes. Where USDA has no code for a method, the nearest one in the
 * same group is used (noted). Groups with no USDA codes at all (oils, spices, breads, sweets,
 * mixed dishes) aren't listed, so their values aren't changed.
 */
export const RETENTION_GROUPS: Record<string, Group> = {
  cheese: { methods: table({ dry: 1, grill: 3, fat: 3, liquid: 5, drained: 5, steam: 5 }), reheated: 7 },
  egg: { methods: table({ dry: 101, fat: 103, grill: 103, drained: 105, steam: 105, liquid: 107, only: { microwaved: 103 } }), reheated: 109 },
  milk: { methods: table({ drained: 2151, liquid: 2151, steam: 2151, dry: 2151, fat: 2151, only: { slow_cooked: 2153 } }), reheated: 2154 },
  fruit: { methods: table({ dry: 151, grill: 152, fat: 153, drained: 155, liquid: 155, steam: 155 }), reheated: 157 },
  fruit_citrus: { methods: table({ dry: 270, fat: 270, drained: 270, liquid: 270, steam: 270 }), reheated: 270 },
  fruit_dried: { methods: table({ dry: 251, fat: 253, drained: 255, liquid: 255, steam: 255 }), reheated: 257 },
  flour: { methods: table({ dry: 301, drained: 302, liquid: 302, steam: 302, fat: 305 }), reheated: 304 },
  oats: { methods: table({ drained: 352, liquid: 352, steam: 352, dry: 301, fat: 305 }), reheated: 352 },
  pasta: { methods: table({ drained: 381, liquid: 384, steam: 384, dry: 380, fat: 381 }), reheated: 385 },
  // Quinoa, barley, bulgur and other grains have no USDA code; the rice codes are the nearest.
  rice: { methods: table({ drained: 431, liquid: 432, steam: 432, dry: 432, fat: 433 }), reheated: 434 },
  legume_short: { methods: table({ drained: 501, liquid: 502, steam: 502, dry: 504, fat: 505 }), reheated: 550 },
  legume: { methods: table({ drained: 521, liquid: 522, steam: 522, dry: 524, fat: 525 }), reheated: 550 },
  beef: { methods: table({ dry: 601, grill: 602, fat: 604, deep: 605, drained: 653, steam: 653, liquid: 654, only: { braised: 652 } }), reheated: 770 },
  beef_ground: { methods: table({ dry: 749, grill: 603, fat: 604, drained: 753, steam: 753, liquid: 754, only: { braised: 752 } }), reheated: 770 },
  chicken: { methods: table({ dry: 805, grill: 801, fat: 803, drained: 855, steam: 855, liquid: 856, only: { braised: 852 } }), reheated: 864 },
  // Turkey has no grilled or fried code in USDA; chicken's are used.
  turkey: { methods: table({ dry: 1805, grill: 801, fat: 803, drained: 1851, steam: 1851, liquid: 1852 }), reheated: 1860 },
  // Lamb has no fried code; broiled is the nearest.
  lamb: { methods: table({ dry: 1004, grill: 1001, fat: 1001, drained: 1055, steam: 1055, liquid: 1056, only: { braised: 1052 } }), reheated: 1074 },
  lamb_ground: { methods: table({ dry: 1003, grill: 1003, fat: 1003, drained: 1055, steam: 1055, liquid: 1056 }), reheated: 1074 },
  veal: { methods: table({ dry: 1954, grill: 1951, fat: 1952, drained: 2003, steam: 2003, liquid: 2004, only: { braised: 2002 } }), reheated: 2064 },
  liver: { methods: table({ dry: 1151, grill: 1151, fat: 1151, drained: 1152, steam: 1152, liquid: 1153 }), reheated: 1154 },
  organ: { methods: table({ dry: 1181, grill: 1181, fat: 1181, drained: 1182, steam: 1182, liquid: 1183 }), reheated: 1184 },
  pork: { methods: table({ dry: 1254, grill: 1251, fat: 1252, drained: 1301, steam: 1301, liquid: 1302 }), reheated: 1407 },
  pork_ground: { methods: table({ dry: 1254, grill: 1251, fat: 1252, drained: 1405, steam: 1405, liquid: 1406, only: { braised: 1402 } }), reheated: 1407 },
  pork_cured: { methods: table({ dry: 1459, grill: 1451, fat: 1451, drained: 1521, steam: 1521, liquid: 1522 }), reheated: 1606 },
  bacon: { methods: table({ dry: 1456, grill: 1456, fat: 1456, drained: 1456, steam: 1456, liquid: 1456 }), reheated: 1456 },
  sausage_raw: { methods: table({ drained: 1705, steam: 1705, liquid: 1706, dry: 1707, fat: 1709 }), reheated: 1712 },
  sausage_cooked: { methods: table({ drained: 1654, steam: 1654, liquid: 1655, dry: 1657, fat: 1659 }), reheated: 1712 },
  fish_lean: { methods: table({ dry: 2301, grill: 2305, fat: 2309, drained: 2401, steam: 2401, liquid: 2402 }), reheated: 2554 },
  fish_fatty: { methods: table({ dry: 2451, grill: 2455, fat: 2459, drained: 2551, steam: 2551, liquid: 2552 }), reheated: 2554 },
  shellfish: { methods: table({ dry: 2750, grill: 2753, fat: 2755, drained: 2761, steam: 2770, liquid: 2762 }), reheated: 2771 },
  nuts: { methods: table({ dry: 2203, grill: 2202, fat: 2203, drained: 2204, liquid: 2204, steam: 2204 }), reheated: 2203 },
  // Greens have no steamed code; boiled in a little water and drained is the nearest.
  greens: { methods: table({ dry: 3001, drained: 3005, steam: 3004, liquid: 3006, fat: 3015, only: { blanched: 3004 } }), reheated: 3018, frozen: 3019 },
  potato: { methods: table({ dry: 3301, drained: 3308, liquid: 3309, steam: 3307, fat: 3315, only: { microwaved: 3301 } }), reheated: 3379 },
  sweet_potato: { methods: table({ dry: 3701, drained: 3708, liquid: 3709, steam: 3707, fat: 3710, only: { microwaved: 3701 } }), reheated: 3711, frozen: 3713 },
  tomato: { methods: table({ dry: 3751, grill: 3752, fat: 3752, drained: 3751, liquid: 3751, steam: 3751 }), reheated: 3754 },
  roots: { methods: table({ dry: 3451, drained: 3455, liquid: 3456, steam: 3464, fat: 3460, only: { blanched: 3454, stir_fried: 3465 } }), reheated: 3468, frozen: 3469 },
  veg: { methods: table({ dry: 3771, drained: 3775, liquid: 3776, steam: 3784, fat: 3780, only: { blanched: 3774, stir_fried: 3785 } }), reheated: 3788, frozen: 3789 },
};

const GREENS = /^(spinach|kale|chard|collards|mustard greens|turnip greens|beet greens|dandelion greens|cabbage|lettuce|arugula|watercress|amaranth leaves|endive|escarole|purslane|lambsquarters|grape leaves|chicory greens|pak-choi|bok choy|swiss chard|cress|radicchio|sweet potato leaves|taro leaves|pumpkin leaves|cowpeas, leafy|broccoli raab)/;
const ROOTS = /^(carrots?|beets|turnips|parsnips|radishes|rutabagas|onions|garlic|leeks|shallots|celeriac|yam|taro|jicama|yambean|ginger root|burdock|salsify|cassava|horseradish|scallions|lotus root|kohlrabi|celery)/;
const CITRUS = /^(oranges?|lemons?|limes?|grapefruit|tangerines?|kumquats|pummelo|lemon juice|lime juice|orange juice|grapefruit juice)/;
const DRIED_FRUIT = /^(raisins|prunes|dates|figs, dried)|, dried|dehydrated/;
const PASTA = /^(pasta|spaghetti|macaroni|noodles)/;
const FLOUR = /flour|meal\b|^semolina|^cornmeal|^masa/;
const GRAINS = /^(rice|wild rice|quinoa|barley|bulgur|millet|buckwheat|couscous|amaranth grain|sorghum grain|farro|spelt|teff|triticale|wheat, (hard|soft|durum|kamut|sprouted))/;
const SHELLFISH = /^(crustaceans|mollusks)/;
const LIVER = /\bliver\b/;
const ORGAN = /variety meats|by-products|\b(heart|kidneys?|tongue|tripe|brain|sweetbread|gizzard)\b/;

/** Which USDA retention group a catalog food belongs to, or null when USDA has none. */
export function retentionGroup(food: Pick<FoodRecord, "description" | "category" | "nutrientsPer100g">): string | null {
  const d = food.description.toLowerCase();
  switch (food.category) {
    case "Dairy and Egg Products":
      if (/^egg/.test(d)) return "egg";
      if (/^cheese/.test(d)) return "cheese";
      if (/^(milk|cream|yogurt|buttermilk|half and half)/.test(d)) return "milk";
      return null;
    case "Fruits and Fruit Juices":
      if (CITRUS.test(d)) return "fruit_citrus";
      if (DRIED_FRUIT.test(d)) return "fruit_dried";
      return "fruit";
    case "Vegetables and Vegetable Products":
      if (/^sweet ?potato/.test(d)) return "sweet_potato";
      if (/^potato/.test(d)) return "potato";
      if (/^tomato/.test(d)) return "tomato";
      if (GREENS.test(d)) return "greens";
      if (ROOTS.test(d)) return "roots";
      return "veg";
    case "Legumes and Legume Products":
      if (/^peanut/.test(d)) return "nuts";
      if (/^(lentils|peas, split)/.test(d)) return "legume_short";
      if (/mature seeds|^beans|^chickpeas|^cowpeas|^lupins|^broadbeans|^soybeans|^mungo|^pigeon peas|^yardlong/.test(d)) return "legume";
      return null;
    case "Cereal Grains and Pasta":
      if (PASTA.test(d)) return "pasta";
      if (/^oat/.test(d)) return "oats";
      if (FLOUR.test(d)) return "flour";
      if (GRAINS.test(d)) return "rice";
      return null;
    case "Breakfast Cereals":
      return /\boat/.test(d) ? "oats" : null;
    case "Beef Products":
      if (LIVER.test(d)) return "liver";
      if (ORGAN.test(d)) return "organ";
      return /ground/.test(d) ? "beef_ground" : "beef";
    case "Poultry Products":
      if (LIVER.test(d)) return "liver";
      if (ORGAN.test(d)) return "organ";
      return /^turkey/.test(d) ? "turkey" : "chicken";
    case "Pork Products":
      if (LIVER.test(d)) return "liver";
      if (ORGAN.test(d)) return "organ";
      if (/bacon/.test(d)) return "bacon";
      if (/cured|^ham|, ham/.test(d)) return "pork_cured";
      return /ground/.test(d) ? "pork_ground" : "pork";
    case "Lamb, Veal, and Game Products":
      if (LIVER.test(d)) return "liver";
      if (ORGAN.test(d)) return "organ";
      if (/^lamb/.test(d)) return /ground/.test(d) ? "lamb_ground" : "lamb";
      if (/^veal/.test(d)) return "veal";
      // Game has no USDA codes; red meat uses beef's, rabbit uses chicken's.
      if (/^game meat, rabbit/.test(d)) return "chicken";
      return /ground/.test(d) ? "beef_ground" : "beef";
    case "Sausages and Luncheon Meats":
      return /\b(raw|fresh)\b/.test(d) ? "sausage_raw" : "sausage_cooked";
    case "Finfish and Shellfish Products": {
      if (SHELLFISH.test(d)) return "shellfish";
      const fat = food.nutrientsPer100g.fat_total;
      return fat !== undefined && fat > 5 ? "fish_fatty" : "fish_lean";
    }
    case "Nut and Seed Products":
      return "nuts";
    default:
      return null;
  }
}

/** The USDA food is already cooked or heat-processed (so cooking it again is "reheated"). */
export function isCookedFood(description: string): boolean {
  return /\b(cooked|boiled|roasted|baked|braised|stewed|steamed|fried|grilled|broiled|microwaved|simmered|canned|heated|toasted|pan-browned|rotisserie|prepared)\b/i.test(description);
}

export interface RetentionMatch {
  code: number;
  description: string;
  /** Nutrient key -> percent retained, as published by USDA. */
  percent: Record<string, number>;
}

/** The USDA retention factors for cooking this food this way, or null when USDA has none. */
export function retentionFor(food: Pick<FoodRecord, "description" | "category" | "nutrientsPer100g">, method: CookingMethod): RetentionMatch | null {
  const groupId = retentionGroup(food);
  if (!groupId) return null;
  const group = RETENTION_GROUPS[groupId]!;
  let code: number | undefined;
  if (isCookedFood(food.description)) code = group.reheated;
  else if (group.frozen && /\bfrozen\b/i.test(food.description) && ["boiled", "blanched", "steamed", "microwaved"].includes(method)) code = group.frozen;
  else code = group.methods[method];
  if (code === undefined) return null;
  const row = RETENTION_FACTORS[code];
  if (!row) return null;
  return { code, description: row.d, percent: row.r };
}
