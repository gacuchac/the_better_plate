import { z } from "@hono/zod-openapi";
import { ErrorSchema } from "@betterplate/contracts";

export const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
export const Err = (description: string) => ({ description, ...json(ErrorSchema) });

export const MealParam = z.object({ id: z.uuid() });
export const MealChildParam = z.object({ id: z.uuid(), childId: z.uuid() });
export const FoodParam = z.object({ foodId: z.string().regex(/^fdc:\d{1,9}$/) });
export const TokenParam = z.object({ token: z.uuid() });

/** Invite emails a cook may send a day, and how often one client can be re-sent theirs. */
export const COOK_INVITE_EMAILS_PER_DAY = 20;
export const COOK_INVITE_DAYS = 30;
