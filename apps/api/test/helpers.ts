import { createApp } from "../src/app.ts";
import { devOutbox } from "../src/lib/mailer.ts";

export const app = createApp();
export const ORIGIN = "http://localhost:3000";

export interface Client {
  email: string;
  cookie: string;
  request: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
}

export function call(path: string, init: RequestInit & { json?: unknown; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  if (init.cookie) headers.set("cookie", init.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return app.request(`http://localhost:4000${path}`, { ...init, headers, body });
}

/** Signs in through the real Better Auth email-OTP flow, reading the code from the local test mailbox. */
export async function signIn(email = `user-${crypto.randomUUID()}@example.test`): Promise<Client> {
  const sent = await call("/v1/auth/email-otp/send-verification-otp", { method: "POST", json: { email, type: "sign-in" } });
  if (sent.status !== 200) throw new Error(`send otp failed ${sent.status} ${await sent.text()}`);
  const code = /code: (\d{6})/.exec(devOutbox(email)[0]?.subject ?? "")?.[1];
  if (!code) throw new Error("no OTP in mailbox");
  const res = await call("/v1/auth/sign-in/email-otp", { method: "POST", json: { email, otp: code } });
  if (res.status !== 200) throw new Error(`sign in failed ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { email, cookie, request: (path, init = {}) => call(path, { ...init, cookie }) };
}

export async function food(id: string) {
  return (await (await call(`/v1/foods/${id}`)).json()) as { nutrientsPer100g: Record<string, number>; portions: { gramWeight: number }[] };
}

export async function findFood(query: string): Promise<string> {
  const body = (await (await call(`/v1/foods?query=${encodeURIComponent(query)}&limit=1`)).json()) as { foods: { id: string }[] };
  if (!body.foods[0]) throw new Error(`no food for ${query}`);
  return body.foods[0].id;
}
