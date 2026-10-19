import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { trackError } from "./activity.ts";
import { AppProvider } from "./store.tsx";
import { App } from "./ui/App.tsx";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./styles.css";

// Remember the last error (message and code location only) for issue reports.
addEventListener("error", (e) => trackError(e.error ?? e.message));
addEventListener("unhandledrejection", (e) => trackError(e.reason));

// Cache the app shell so the kitchen opens with no connection.
if ("serviceWorker" in navigator && import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
