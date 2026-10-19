/** Browser configuration. Only PUBLIC_* values exist here; nothing secret is ever bundled. */
// Hosted builds leave PUBLIC_API_URL unset: the API serves the app, so it is the same origin.
export const API_URL = (import.meta.env.PUBLIC_API_URL || (import.meta.env.DEV ? "http://localhost:4000" : location.origin)).replace(/\/$/, "");
