import type { FoodRecord, RecipeForCalculation } from "./types.ts";

/**
 * The nine major food allergens named in US law: FALCPA (2004) and the FASTER Act (2021, sesame).
 * USDA SR Legacy records carry no allergen fields, so tags here come from rules on each food's
 * USDA name and category. They are warnings to check labels, never a statement that a food is safe.
 */
export const ALLERGENS = ["milk", "egg", "fish", "shellfish", "tree_nuts", "peanut", "wheat", "soy", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Bump when a rule changes; stored nowhere, shown with the tags so people know which rules they saw. */
export const ALLERGEN_RULES_VERSION = "allergen-rules-1";

export const ALLERGEN_SOURCE = {
  publisher: "U.S. Food and Drug Administration",
  title: "Food Allergies: What You Need to Know (the major food allergens)",
  url: "https://www.fda.gov/food/food-labeling-nutrition/food-allergies",
} as const;

/**
 * Categories of prepared or mixed foods (breads, sweets, fast food, soups, baby food…). Their recipes
 * vary by brand, so a name rule can miss an allergen; these foods are marked "may contain others".
 */
const MIXED_CATEGORIES = new Set([
  "Baked Products",
  "Sweets",
  "Fast Foods",
  "Restaurant Foods",
  "Meals, Entrees, and Side Dishes",
  "Soups, Sauces, and Gravies",
  "Snacks",
  "Baby Foods",
  "Breakfast Cereals",
  "Sausages and Luncheon Meats",
]);

// Rules on the lower-cased USDA description. Each allergen has words that tag it and words that
// look alike but are not that allergen (eggplant, butternut squash, coconut milk, water chestnut).
// `unless` phrases contain a matching word and are removed before a second look; `never` drops the tag.
const RULES: Record<Allergen, { match: RegExp; unless?: RegExp; never?: RegExp }> = {
  milk: {
    match: /\b(milk|cheeses?|butter|buttermilk|cream|creamer|yogurt|yoghurt|whey|casein|caseinate|ghee|kefir|custard|pudding|curd|ricotta|mozzarella|cheddar|parmesan|lactose|dairy|nougat|milk chocolate|eggnog|alfredo|ranch)\b/,
    unless:
      /\b(coconut milk|soymilk|soy milk|almond milk|rice milk|oat milk|cashew milk|milkfish|cocoa butter|peanut butter|apple butter|almond butter|cashew butter|sesame butter|nut butter|seed butter|sunflower seed butter|butter beans?|butterhead|butterbur|butternut|butterfish|cream of tartar|soy yogurt|nondairy|non-dairy|imitation|bean curd|cream of rice|cream of wheat|cream soda|no cheese|without cheese|butter replacement|bread and butter pickles|custard-apple)\b/,
  },
  egg: {
    match: /\b(eggs?|egg yolk|egg white|eggnog|mayonnaise|mayo|meringue|custard|french toast|hollandaise)\b/,
    unless: /\b(eggless|custard-apple)\b/,
  },
  fish: {
    // Common names only: the Finfish category rule below covers every other species.
    match:
      /\b(fish|anchov(y|ies)|salmon|tuna|cod|haddock|halibut|herring|mackerel|sardines?|trout|tilapia|pollock|catfish|swordfish|whitefish|roe|caviar|surimi|lox|worcestershire)\b/,
    unless: /\b(shellfish|crayfish|crawfish|starfish|fish-shaped)\b/,
  },
  shellfish: {
    match: /\b(crab|crabs|lobster|shrimps?|prawns?|crayfish|crawfish|langoustines?|krill|shellfish)\b/,
    unless: /\b(crabapples?|crab apples?|imitation)\b/,
  },
  tree_nuts: {
    match:
      /\b(almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|filberts?|macadamias?|macadamia nuts?|brazilnuts?|brazil nuts?|pine nuts?|pinyon|pignolia|chestnuts?|beechnuts?|hickorynuts?|hickory nuts?|butternuts?|praline|marzipan|gianduja|mixed nuts|nuts, mixed|nut butter|nougat)\b/,
    unless: /\b(water chestnuts?|squash, winter, butternut|butternut squash|nutmeg|coconut|except macadamia)\b/,
  },
  peanut: { match: /\b(peanuts?|peanut butter|peanut oil|groundnuts?|goobers?)\b/, unless: /\bwithout peanuts\b/ },
  wheat: {
    match:
      /\b(wheat|flour|bread|breads|breadcrumbs?|bread crumbs|buns?|bagels?|biscuits?|crackers?|croissants?|croutons?|pasta|spaghetti|macaroni|noodles?|lasagna|ravioli|tortellini|couscous|semolina|bulgur|farina|durum|spelt|kamut|seitan|pretzels?|pizza|pancakes?|waffles?|muffins?|cakes?|cookies?|pie crust|pot pie|pastry|pastries|doughnuts?|strudel|graham|matzo|matzoh|pita|naan|soy sauce|teriyaki|gravy|breaded|batter|battered|dumplings?|wontons?|potstickers?|sandwich|burrito|flour tortillas?|cereal|bran|stuffing|crepes?|brownies?|cream puffs?|eclairs?|ice cream cones?|sugar cones?|waffle cones?|sundae cones?|egg rolls?)\b/,
    unless:
      /\b(buckwheat|(carob|acorn|peanut|cottonseed|sesame|sunflower seed|masa|rice|corn|potato|soy|almond|coconut|chickpea|arrowroot|tapioca|rye|oat|lupin|mesquite|cassava) flour|cornflour|rice cakes?|rice cake, cracker|rice crackers?|rice cracker|corn cakes|popcorn, cakes|rice noodles?|noodles, chinese, cellophane|potato pancakes?|sandwich steaks|oat bran|rice bran|corn bran|not breaded|sandwich spread|bread and butter pickles|squash, winter, spaghetti|spaghetti squash|piki bread|bread, blue corn|bread, kneel down|soy sauce made from soy \(tamari\))/,
    never: /\b(gluten- ?free|wheat-free)\b/,
  },
  soy: {
    match: /\b(soy|soya|soybeans?|soymilk|tofu|tempeh|miso|edamame|natto|okara|yuba|tamari|teriyaki|textured vegetable protein|tvp)\b/,
    unless: /\bnon-soy\b/,
  },
  sesame: { match: /\b(sesame|tahini|tahina|halva|halvah|hummus|benne)\b/ },
};

export interface FoodAllergens {
  allergens: Allergen[];
  /** A prepared or mixed food whose ingredients vary; it may contain allergens the name does not show. */
  mayContainOthers: boolean;
}

const cache = new WeakMap<object, FoodAllergens>();

/** Allergen tags for one catalog food, from its USDA name and category. */
export function foodAllergens(food: Pick<FoodRecord, "description" | "category">): FoodAllergens {
  const hit = cache.get(food);
  if (hit) return hit;
  const name = food.description.toLowerCase();
  const category = food.category ?? "";
  const tags = new Set<Allergen>();
  for (const allergen of ALLERGENS) {
    const rule = RULES[allergen];
    if (!rule.match.test(name) || rule.never?.test(name)) continue;
    // Industrial fats name their uses ("for flaky pastries"), not their ingredients.
    if (allergen === "wheat" && category === "Fats and Oils" && !name.includes("wheat")) continue;
    // Look-alikes are removed from the name before a second look, so "butternut squash with butter" still counts.
    if (rule.unless && !rule.match.test(name.replace(new RegExp(rule.unless.source, "g"), " "))) continue;
    tags.add(allergen);
  }
  // Category rules for the whole groups of fish and dairy; mollusks (clams, oysters…) are not one of the nine.
  if (category === "Finfish and Shellfish Products" && !tags.has("shellfish") && !/\b(clams?|oysters?|mussels?|scallops?|squid|octopus|snails?|whelks?|abalone|conch|cuttlefish)\b/.test(name)) {
    tags.add("fish");
  }
  if (category === "Dairy and Egg Products" && !tags.has("egg")) tags.add("milk");
  const result = { allergens: ALLERGENS.filter((a) => tags.has(a)), mayContainOthers: MIXED_CATEGORIES.has(category) };
  cache.set(food, result);
  return result;
}

export interface RecipeAllergens {
  allergens: Allergen[];
  /** Ingredient ids per allergen, so the app can say which ingredient carries it. */
  byAllergen: Partial<Record<Allergen, string[]>>;
  /** Ingredient ids of prepared or mixed foods that may contain more than their name shows. */
  mayContainOthers: string[];
  /** Ingredient ids whose food is not in the catalog, so they were not checked. */
  unchecked: string[];
}

export function recipeAllergens(recipe: Pick<RecipeForCalculation, "ingredients">, foods: ReadonlyMap<string, FoodRecord>): RecipeAllergens {
  const byAllergen: Partial<Record<Allergen, string[]>> = {};
  const mayContainOthers: string[] = [];
  const unchecked: string[] = [];
  for (const ingredient of recipe.ingredients) {
    const food = foods.get(ingredient.foodId);
    if (!food) {
      unchecked.push(ingredient.id);
      continue;
    }
    const tags = foodAllergens(food);
    for (const a of tags.allergens) (byAllergen[a] ??= []).push(ingredient.id);
    if (tags.mayContainOthers) mayContainOthers.push(ingredient.id);
  }
  return { allergens: ALLERGENS.filter((a) => byAllergen[a]), byAllergen, mayContainOthers, unchecked };
}

/**
 * What to tell someone about a recipe given the allergens they listed. An alert, never a block:
 * matches are listed, and "possible" covers mixed foods and unchecked ingredients.
 */
export function allergenAlert(recipe: RecipeAllergens, listed: readonly string[]): { matches: Allergen[]; possible: boolean } {
  const matches = recipe.allergens.filter((a) => listed.includes(a));
  return { matches, possible: listed.length > 0 && (recipe.mayContainOthers.length > 0 || recipe.unchecked.length > 0) };
}
