import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Only PUBLIC_* variables reach the browser bundle; secrets never use that prefix.
export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  envPrefix: "PUBLIC_",
  server: { port: Number(process.env.WEB_PORT ?? 3000), strictPort: true },
  preview: { port: Number(process.env.WEB_PORT ?? 3000), strictPort: true },
  build: {
    rollupOptions: {
      // zod ships comments Rollup reports as misplaced annotations; harmless noise.
      onwarn(warning, warn) {
        if (warning.code !== "INVALID_ANNOTATION") warn(warning);
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "The Better Plate",
        short_name: "Better Plate",
        description: "Your kitchen, offline: recipes, cooking and evidence-based nutrition estimates.",
        theme_color: "#FAFBF9",
        background_color: "#FAFBF9",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        // App shell only. Personal data lives in IndexedDB, never in the service worker cache.
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/v1\//],
        runtimeCaching: [],
      },
    }),
  ],
});
