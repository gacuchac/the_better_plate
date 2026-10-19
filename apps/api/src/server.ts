import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/pool.ts";
import { scheduleMaintenance } from "./jobs.ts";

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(JSON.stringify({ level: "info", msg: "api listening", port: info.port, env: config.appEnv }));
});

// Outlive the idle keep-alive of clients and proxies, so a reused connection isn't closed
// under an in-flight request (Node's 5 s default caused "socket hang up").
const http = server as import("node:http").Server;
http.keepAliveTimeout = 65_000;
http.headersTimeout = 66_000;

const stopMaintenance = scheduleMaintenance();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopMaintenance();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
