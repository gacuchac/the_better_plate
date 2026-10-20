import type { DailyValue } from "@betterplate/nutrition";
import type { SyncEngine } from "./sync.ts";
import { localDate } from "./meals.ts";

/**
 * Daily targets from before goals were stored on the server (kept per account in localStorage).
 * They move into daily goals once, then leave the device. Nutrients people usually limit become
 * "at most" goals, everything else "at least"; the person can change either on the Goals screen.
 */
const key = (accountId: string) => `bp.targets.${accountId}`;
const LIMITED = new Set(["sodium", "fat_saturated", "sugars_total", "cholesterol"]);

function isTarget(v: unknown): v is DailyValue {
  const t = v as DailyValue;
  return typeof t?.key === "string" && typeof t.unit === "string" && typeof t.amount === "number" && t.amount > 0 && t.amount < 1_000_000;
}

export function getLegacyTargets(accountId: string): DailyValue[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(accountId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter(isTarget) : [];
  } catch {
    return [];
  }
}

export function clearTargets(accountId: string) {
  try {
    localStorage.removeItem(key(accountId));
  } catch {
    // Storage blocked: nothing kept.
  }
}

export async function migrateTargets(accountId: string, engine: Pick<SyncEngine, "saveGoal">, today = localDate()): Promise<number> {
  const targets = getLegacyTargets(accountId);
  for (const t of targets) {
    const atMost = LIMITED.has(t.key);
    await engine.saveGoal(crypto.randomUUID(), {
      nutrientKey: t.key,
      unit: t.unit,
      kind: atMost ? "at_most" : "at_least",
      min: atMost ? null : t.amount,
      max: atMost ? t.amount : null,
      period: "day",
      startDate: today,
      endDate: null,
    });
  }
  if (targets.length) clearTargets(accountId);
  return targets.length;
}
