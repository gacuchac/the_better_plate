/**
 * Recent readable steps for issue reports ("Opened Meals", "Saved a recipe", "Sync failed").
 * Kept in memory only, never raw keystrokes or typed content, and shown to the person
 * (who can remove lines) before anything is sent.
 */
export interface ActivityEvent {
  at: string;
  event: string;
}

const MAX = 30;
const events: ActivityEvent[] = [];
const requestIds: string[] = [];
let lastError: { message: string; stack?: string } | null = null;

export function track(event: string) {
  events.push({ at: new Date().toISOString(), event: event.slice(0, 160) });
  if (events.length > MAX) events.shift();
}

/** Request ids of recent failed API calls, so a report can be matched to server logs. */
export function trackFailedRequest(requestId: string | null | undefined) {
  if (!requestId) return;
  requestIds.push(requestId.slice(0, 64));
  if (requestIds.length > 10) requestIds.shift();
}

export function trackError(err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  // Message and code locations only; no values from the page.
  lastError = { message: e.message.slice(0, 500), stack: e.stack?.split("\n").slice(0, 8).join("\n").slice(0, 2000) };
  track("Something went wrong in the app");
}

export function snapshot() {
  return { events: [...events], requestIds: [...requestIds], error: lastError };
}

const ROUTE_NAMES: [RegExp, string][] = [
  [/^\/kitchen$/, "Opened Your Kitchen"],
  [/^\/recipe\//, "Opened a recipe"],
  [/^\/meals/, "Opened Meals"],
  [/^\/cook\//, "Started cook mode"],
  [/^\/explore$/, "Opened Explore"],
  [/^\/you$/, "Opened You"],
  [/^\/targets$/, "Opened daily targets"],
];

export function trackRoute(route: string) {
  const name = ROUTE_NAMES.find(([re]) => re.test(route))?.[1];
  if (name) track(name);
}
