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

export async function sendEmail(message: Omit<OutgoingEmail, "sentAt">): Promise<void> {
  if (config.isLocal) {
    outbox.push({ ...message, sentAt: new Date().toISOString() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    if (config.appEnv === "local") console.info(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }
  // Transactional email provider is chosen in ADR-002 and needs owner setup (preflight S5).
  throw new Error("No email provider configured for this environment (preflight S5)");
}
