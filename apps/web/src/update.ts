import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

// New versions of the app shell wait until the person taps Update, so nothing reloads under
// them mid-edit. Browsers (iOS especially) only look for a new version on a fresh load, so the
// app also asks when it comes back to the foreground and every 30 minutes while open.

const READY = "bp:update-ready";
let apply: (() => Promise<void>) | null = null;

export function registerAppUpdates() {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      apply = () => updateSW(true);
      dispatchEvent(new Event(READY));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => undefined);
      };
      setInterval(check, 30 * 60_000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}

/** True once a new version is downloaded and waiting. */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(apply !== null);
  useEffect(() => {
    const on = () => setReady(true);
    addEventListener(READY, on);
    return () => removeEventListener(READY, on);
  }, []);
  return ready;
}

export function applyUpdate() {
  void apply?.();
}
