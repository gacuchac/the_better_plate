import { config } from "../config.ts";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

// Local and test only: keeps recent messages in memory so developers and automated
// tests can read sign-in codes without a real inbox. Never enabled in dev/production.
const outbox: OutgoingEmail[] = [];
const OUTBOX_LIMIT = 200;

export function devOutbox(email?: string): OutgoingEmail[] {
  if (!config.isLocal) return [];
  const all = email ? outbox.filter((m) => m.to.toLowerCase() === email.toLowerCase()) : outbox;
  return [...all].reverse();
}

/** Splits "Name <address>" into its parts; a bare address has no name. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1] || undefined, email: match[2]! } : { email: from.trim() };
}

/** Builds the provider HTTPS request. Both providers are send-only HTTP APIs (no SMTP). */
export function providerRequest(provider: "resend" | "brevo", apiKey: string, from: string, message: Omit<OutgoingEmail, "sentAt">): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === "resend") {
    return {
      url: "https://api.resend.com/emails",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: { from, to: [message.to], subject: message.subject, text: message.text },
    };
  }
  return {
    url: "https://api.brevo.com/v3/smtp/email",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: { sender: parseSender(from), to: [{ email: message.to }], subject: message.subject, textContent: message.text },
  };
}

export async function sendEmail(message: Omit<OutgoingEmail, "sentAt">): Promise<void> {
  if (config.isLocal) {
    outbox.push({ ...message, sentAt: new Date().toISOString() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    if (config.appEnv === "local") console.info(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }
  if (!config.emailProvider || !config.emailProviderKey) throw new Error("No email provider configured for this environment (preflight S5)");
  const req = providerRequest(config.emailProvider, config.emailProviderKey, config.emailFrom, message);
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    // Provider bodies can echo the recipient address, so keep only the error code and a message with addresses removed.
    throw new Error(`email provider ${config.emailProvider} returned ${res.status}${await providerReason(res)}`);
  }
}

/** " (code: message)" from a provider error body, with email addresses redacted; empty when unreadable. */
export async function providerReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown; name?: unknown; message?: unknown };
    const code = typeof body.code === "string" ? body.code : typeof body.name === "string" ? body.name : "";
    const message = typeof body.message === "string" ? body.message.replace(/[^\s<>"']+@[^\s<>"']+/g, "[address]").slice(0, 200) : "";
    const reason = [code, message].filter(Boolean).join(": ");
    return reason ? ` (${reason})` : "";
  } catch {
    return "";
  }
}
