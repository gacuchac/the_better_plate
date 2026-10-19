/** Fresh schema for every run: drop and recreate the test database objects, then migrate and seed. */
export default async function setup() {
  const { pool } = await import("../src/db/pool.ts");
  const { migrate } = await import("../src/db/migrate.ts");
  const { seedCatalog } = await import("../src/db/seed.ts");
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool, () => {});
  await seedCatalog(pool, () => {});
  await pool.end();
}
