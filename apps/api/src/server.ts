import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(JSON.stringify({ level: "info", msg: "api listening", port: info.port, env: config.appEnv }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
