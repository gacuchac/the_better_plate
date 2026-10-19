import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Applies pending SQL migrations in filename order, each in its own transaction. Refuses edited migrations. */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = console.info): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock(727001)");
    await client.query(
      "create table if not exists schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())",
    );
    const done = new Map(
      (await client.query<{ name: string; sha256: string }>("select name, sha256 from schema_migrations")).rows.map((r) => [r.name, r.sha256]),
    );
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const prior = done.get(file);
      if (prior) {
        if (prior !== sha) throw new Error(`Migration ${file} was edited after being applied; add a new migration instead`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name, sha256) values ($1, $2)", [file, sha]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query("select pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
  return applied;
}
