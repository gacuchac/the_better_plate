import { pool } from "./db/pool.ts";

/**
 * Idempotency records are kept 30 days. A retry older than that is still safe: every write is
 * version-checked (recipes, plans) or keyed by its own id (eaten meals), so a replay conflicts
 * or is recognized instead of applying twice.
 */
export const SYNC_LEDGER_DAYS = 30;

/** Daily housekeeping; one instance at a time (advisory lock), safe to run repeatedly. */
export async function runMaintenance(): Promise<{ syncOperations: number; sessions: number; images: number } | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('betterplate:maintenance')) as locked");
    if (!rows[0]?.locked) return null;
    try {
      const ops = await client.query(`delete from sync_operations where created_at < now() - make_interval(days => $1)`, [SYNC_LEDGER_DAYS]);
      // Expired sign-in sessions hold an IP address and browser description; keep them no longer than needed.
      const sessions = await client.query(`delete from "sessions" where "expiresAt" < now()`);
      // Recipe images no live recipe or live share link uses, after a week (revisions keep only the reference).
      // Any live recipe counts: a group recipe may carry a photo another admin added.
      const images = await client.query(
        `delete from recipe_images i where created_at < now() - interval '7 days'
           and not exists (select 1 from recipes r where r.deleted_at is null and r.body->'image'->>'id' = i.id::text)
           and not exists (select 1 from share_snapshots s where s.user_id = i.user_id and s.revoked_at is null
                             and (s.expires_at is null or s.expires_at > now()) and s.snapshot->'image'->>'id' = i.id::text)`,
      );
      return { syncOperations: ops.rowCount ?? 0, sessions: sessions.rowCount ?? 0, images: images.rowCount ?? 0 };
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('betterplate:maintenance'))");
    }
  } finally {
    client.release();
  }
}

export function scheduleMaintenance(): () => void {
  const run = () =>
    void runMaintenance().then(
      (result) => result && console.info(JSON.stringify({ level: "info", msg: "maintenance", ...result })),
      (err) => console.error(JSON.stringify({ level: "error", msg: "maintenance failed", error: (err as Error).message })),
    );
  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
