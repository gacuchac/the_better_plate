/** Browser configuration. Only PUBLIC_* values exist here; nothing secret is ever bundled. */
export const API_URL = (import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
