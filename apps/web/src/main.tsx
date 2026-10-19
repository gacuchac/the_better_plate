import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { AppProvider } from "./store.tsx";
import { App } from "./ui/App.tsx";
import "./styles.css";

// Cache the app shell so the kitchen opens with no connection.
if ("serviceWorker" in navigator && import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
