import { useSyncExternalStore } from "react";

/**
 * Gentle mode: hide goal marks, goal progress words and over/remaining numbers. A per-device
 * display choice only; it is never sent anywhere and changes no data.
 */
const KEY = "bp.gentle";
const listeners = new Set<() => void>();

export function readGentle(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setGentle(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; the choice then lasts only until reload.
  }
  for (const l of listeners) l();
}

export function useGentle(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readGentle,
    () => false,
  );
}
