import pg from "pg";
import { config } from "../config.ts";

// Return BIGINT (int8) as string so sequence cursors never lose precision.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
