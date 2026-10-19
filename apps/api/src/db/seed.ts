import { readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { REPO_ROOT } from "../config.ts";

export const CATALOG_FILE = path.join(REPO_ROOT, "data", "catalog", "starter-catalog.json");

interface CatalogSnapshot {
  schema: string;
  version: string;
  retrievedAt: string;
  contentSha256: string;
  source: unknown;
  nutrients: unknown[];
  foods: Array<{
    id: string;
    fdcId: number;
    description: string;
    dataType: string;
    category: string | null;
    ndbNumber: string | number | null;
    publicationDate: string | null;
    nutrientsPer100g: Record<string, number>;
    portions: unknown[];
    source: unknown;
  }>;
}

export function readCatalogSnapshot(file = CATALOG_FILE): CatalogSnapshot {
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as CatalogSnapshot;
  if (snapshot.schema !== "betterplate.catalog/1") throw new Error(`Unsupported catalog schema ${snapshot.schema}`);
  return snapshot;
}

/** Loads the committed USDA snapshot into the catalog tables. Idempotent per catalog version. */
export async function seedCatalog(pool: pg.Pool, log: (msg: string) => void = console.info, file = CATALOG_FILE): Promise<string> {
  const snap = readCatalogSnapshot(file);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select is_current from catalog_versions where version = $1", [snap.version]);
    if (existing.rowCount && existing.rows[0].is_current) {
      await client.query("commit");
      log(`catalog ${snap.version} already current (${snap.foods.length} foods)`);
      return snap.version;
    }
    await client.query("update catalog_versions set is_current = false where is_current");
    await client.query(
      `insert into catalog_versions (version, schema, retrieved_at, content_sha256, food_count, source, nutrients, is_current)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (version) do update set is_current = true`,
      [snap.version, snap.schema, snap.retrievedAt, snap.contentSha256, snap.foods.length, JSON.stringify(snap.source), JSON.stringify(snap.nutrients)],
    );
    for (const f of snap.foods) {
      // Food ids are stable across catalog versions; recipes keep their own nutrition snapshots.
      await client.query(
        `insert into food_items (id, fdc_id, description, data_type, category, ndb_number, publication_date, nutrients_per_100g, portions, source, catalog_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (id) do update set description = excluded.description, data_type = excluded.data_type, category = excluded.category,
           ndb_number = excluded.ndb_number, publication_date = excluded.publication_date, nutrients_per_100g = excluded.nutrients_per_100g,
           portions = excluded.portions, source = excluded.source, catalog_version = excluded.catalog_version, updated_at = now()`,
        [f.id, f.fdcId, f.description, f.dataType, f.category, f.ndbNumber == null ? null : String(f.ndbNumber), f.publicationDate,
          JSON.stringify(f.nutrientsPer100g), JSON.stringify(f.portions), JSON.stringify(f.source), snap.version],
      );
    }
    await client.query("commit");
    log(`catalog ${snap.version} loaded (${snap.foods.length} foods)`);
    return snap.version;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
