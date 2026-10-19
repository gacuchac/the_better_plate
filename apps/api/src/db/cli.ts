import { pool } from "./pool.ts";
import { migrate } from "./migrate.ts";
import { seedCatalog } from "./seed.ts";

const command = process.argv[2];
try {
  if (command === "migrate" || command === "setup") await migrate(pool);
  if (command === "seed" || command === "setup") await seedCatalog(pool);
  if (!["migrate", "seed", "setup"].includes(command ?? "")) {
    console.error("usage: cli.ts migrate|seed|setup");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
