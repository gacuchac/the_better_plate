import { pool } from "./pool.ts";
import { migrate } from "./migrate.ts";
import { seedCatalog } from "./seed.ts";

const command = process.argv[2];
try {
  if (command === "reset") {
    // Throwaway databases only: used by the E2E run to start from a clean, seeded schema.
    const db = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
    if (!["local", "test"].includes(process.env.APP_ENV ?? "") || !/_(e2e|test)$/.test(db)) {
      throw new Error(`refusing to reset database "${db}" (APP_ENV=${process.env.APP_ENV})`);
    }
    await pool.query("drop schema public cascade; create schema public;");
    await migrate(pool, () => {});
    await seedCatalog(pool);
  }
  if (command === "migrate" || command === "setup") await migrate(pool);
  if (command === "seed" || command === "setup") await seedCatalog(pool);
  if (!["migrate", "seed", "setup", "reset"].includes(command ?? "")) {
    console.error("usage: cli.ts migrate|seed|setup|reset");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
