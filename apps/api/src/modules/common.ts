import { z } from "@hono/zod-openapi";
import { ErrorSchema } from "@betterplate/contracts";

const err = { content: { "application/json": { schema: ErrorSchema } } };
export const ErrorResponses = {
  400: { description: "Invalid request", ...err },
  401: { description: "Not signed in", ...err },
  404: { description: "Not found (or not yours)", ...err },
  429: { description: "Rate limited", ...err },
} as const;

export const IdParam = z.object({ id: z.uuid() });
