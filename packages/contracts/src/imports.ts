import { z } from "zod";

/**
 * Reading a recipe from photos (FEATURE_RECIPE_PHOTO_IMPORT_ENABLED). The photos are read once by
 * an AI model and never stored. The answer is a draft for the person to review: every line keeps
 * the text as printed, the USDA food it was matched to (from the catalog, never invented) and the
 * amount in a unit the app can weigh, or null where it couldn't tell.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const FoodIdSchema = z.string().regex(/^fdc:\d{1,9}$/);

export const MAX_IMPORT_IMAGES = 4;
/** Each photo in base64; the app scales phone photos down before sending. */
export const MAX_IMPORT_IMAGE_BASE64 = 8_000_000;
export const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_IMAGES * MAX_IMPORT_IMAGE_BASE64 + 64 * 1024;

export const RecipeImportRequestSchema = z.object({
  /** One to four photos (pages of the same recipe, in order), base64. */
  images: z.array(z.string().min(1).max(MAX_IMPORT_IMAGE_BASE64)).min(1).max(MAX_IMPORT_IMAGES),
  /** The person confirms they took the photos or may use the recipe. */
  rightsConfirmed: z.literal(true),
});

export const ImportCandidateSchema = z.object({ foodId: FoodIdSchema, description: z.string() });

export const ImportedLineSchema = z.object({
  id: z.uuid(),
  /** The line as printed, in the recipe's own language. */
  original: trimmed(300),
  /** English name the catalog was searched with. */
  foodName: trimmed(200),
  /** Preparation as written ("finely chopped"). */
  notes: trimmed(200),
  quantity: z.number().positive().nullable(),
  /** The unit as written ("cups", "cloves", "g"), or empty. */
  unitText: trimmed(40),
  /** The catalog food it was matched to, or null when none of the candidates fit. */
  foodId: FoodIdSchema.nullable(),
  /** The best catalog matches, for picking another. */
  candidates: z.array(ImportCandidateSchema).max(8),
  /** The amount in a unit the app can weigh, or null for the person to fill in. */
  amount: z
    .object({ quantity: z.number().positive(), unit: z.enum(["g", "kg", "oz", "lb", "portion"]), portionIndex: z.number().int().min(0).nullable() })
    .nullable(),
  role: z.enum(["ingredient", "cooking_oil"]),
});

export const RecipeImportSchema = z.object({
  title: trimmed(120),
  description: trimmed(500),
  /** Servings as printed, or null when the recipe doesn't say. */
  servings: z.number().positive().max(100).nullable(),
  /** ISO 639-1 code of the recipe's language, as the model read it. */
  language: trimmed(10),
  method: trimmed(10_000),
  lines: z.array(ImportedLineSchema).max(100),
  /** When it was read; becomes the recipe's origin once saved. */
  importedAt: z.iso.datetime(),
  /** Reads left today on the included companion, or null on the person's own key. */
  readsLeftToday: z.number().int().min(0).nullable(),
});

export type RecipeImportRequest = z.infer<typeof RecipeImportRequestSchema>;
export type ImportedLine = z.infer<typeof ImportedLineSchema>;
export type RecipeImport = z.infer<typeof RecipeImportSchema>;
