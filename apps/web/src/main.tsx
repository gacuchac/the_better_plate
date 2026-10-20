import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { trackError } from "./activity.ts";
import { isQuotaError, STORAGE_FULL_EVENT } from "./localdb.ts";
import { AppProvider } from "./store.tsx";
import { registerAppUpdates } from "./update.ts";
import { App } from "./ui/App.tsx";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./styles.css";

// Remember the last error (message and code location only) for issue reports.
addEventListener("error", (e) => trackError(e.error ?? e.message));
addEventListener("unhandledrejection", (e) => {
  trackError(e.reason);
  if (isQuotaError(e.reason)) dispatchEvent(new Event(STORAGE_FULL_EVENT));
});

// Cache the app shell so the kitchen opens with no connection; offer new versions as they arrive.
if ("serviceWorker" in navigator && import.meta.env.PROD) registerAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
