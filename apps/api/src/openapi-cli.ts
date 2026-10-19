import { writeFileSync } from "node:fs";
import path from "node:path";
import { createApp, openApiInfo } from "./app.ts";
import { pool } from "./db/pool.ts";
import { REPO_ROOT } from "./config.ts";

/** Writes the checked-in OpenAPI 3.1 contract. CI fails if it drifts from the code (test/openapi.test.ts). */
export function generateOpenApi() {
  const doc = createApp().getOpenAPI31Document({ ...openApiInfo, servers: [{ url: "http://localhost:4000" }] });
  return JSON.stringify(doc, null, 2) + "\n";
}

if (process.argv[1]?.endsWith("openapi-cli.ts")) {
  const out = path.join(REPO_ROOT, "apps/api/openapi.json");
  writeFileSync(out, generateOpenApi());
  console.info(`wrote ${path.relative(REPO_ROOT, out)}`);
  await pool.end();
}
