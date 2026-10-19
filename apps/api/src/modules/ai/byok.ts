import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../../config.ts";

/**
 * Provider keys at rest: AES-256-GCM under BYOK_ENCRYPTION_KEY, a fresh IV per key, and the
 * user id and provider as associated data so a ciphertext can't be moved to another account.
 */
export interface SealedKey {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function key(): Buffer {
  if (!config.byokKey) throw new Error("AI companion is off: no BYOK key configured");
  return config.byokKey;
}

const aad = (userId: string, provider: string) => Buffer.from(`${userId}:${provider}`);

export function sealKey(apiKey: string, userId: string, provider: string): SealedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(userId, provider));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function openKey(sealed: SealedKey, userId: string, provider: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), sealed.iv);
  decipher.setAAD(aad(userId, provider));
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

/** What the person sees to recognise a key: its last four characters. */
export const keyHint = (apiKey: string) => `…${apiKey.slice(-4)}`;
