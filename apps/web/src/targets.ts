import { useSyncExternalStore } from "react";
import type { DailyValue } from "@betterplate/nutrition";

/**
 * Daily targets the person types in themselves (e.g. protein 155 g). The app never computes
 * them from body data and never suggests values. Kept only on this device, per account, and
 * removed when the account signs out.
 */
const key = (accountId: string) => `bp.targets.${accountId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, DailyValue[]>();
const EMPTY: DailyValue[] = [];

function read(accountId: string): DailyValue[] {
  const hit = cache.get(accountId);
  if (hit) return hit;
  let parsed: DailyValue[] = EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(key(accountId)) ?? "[]") as unknown;
    if (Array.isArray(raw)) parsed = raw.filter(isTarget);
  } catch {
    // Unreadable or blocked storage: no targets.
  }
  cache.set(accountId, parsed);
  return parsed;
}

function isTarget(v: unknown): v is DailyValue {
  const t = v as DailyValue;
  return typeof t?.key === "string" && typeof t.unit === "string" && typeof t.amount === "number" && t.amount > 0 && t.amount < 1_000_000;
}

export function getTargets(accountId: string | undefined): DailyValue[] {
  return accountId ? read(accountId) : EMPTY;
}

export function saveTargets(accountId: string, targets: DailyValue[]) {
  const clean = targets.filter(isTarget);
  cache.set(accountId, clean);
  try {
    if (clean.length) localStorage.setItem(key(accountId), JSON.stringify(clean));
    else localStorage.removeItem(key(accountId));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((fn) => fn());
}

export function clearTargets(accountId: string) {
  saveTargets(accountId, []);
}

export function useTargets(accountId: string | undefined): DailyValue[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => getTargets(accountId),
    () => EMPTY,
  );
}
