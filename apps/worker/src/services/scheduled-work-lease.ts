/** Durable ownership for bounded scheduled work; no process-local lock is relied on. */
export interface ScheduledWorkLease {
  /** Renew before starting another work unit. A replaced or expired owner cannot continue. */
  renew(): Promise<boolean>;
}

// A scheduled invocation cannot outlive 15 minutes. Leave room for a final D1 call
// so an interrupted invocation finishes before another owner can take over.
const LEASE_MS = 20 * 60_000;
export const SCHEDULED_WORK_BUDGET_MS = 50_000;

export async function withScheduledWorkLease<T>(
  db: D1Database,
  job: string,
  run: (lease: ScheduledWorkLease) => Promise<T>,
  clock: () => number = Date.now,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const key = `scheduled-work:${job}`;
  const owner = crypto.randomUUID();
  const started = clock();
  const value = (now: number) => JSON.stringify({ owner, expiresAt: now + LEASE_MS });
  const claimed = await db.prepare(`
    INSERT INTO platform_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, 'scheduled-work', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    WHERE CASE WHEN json_valid(platform_settings.value)
      THEN COALESCE(json_extract(platform_settings.value, '$.expiresAt'), 0)
      ELSE 0 END <= ?
  `).bind(key, value(started), new Date(started).toISOString(), started).run();
  if (Number(claimed.meta.changes) !== 1) return { acquired: false };

  const lease: ScheduledWorkLease = {
    async renew() {
      const now = clock();
      const renewed = await db.prepare(`
        UPDATE platform_settings SET value=?, updated_at=?
         WHERE key=? AND json_valid(value)
           AND json_extract(value, '$.owner')=?
           AND json_extract(value, '$.expiresAt')>?
      `).bind(value(now), new Date(now).toISOString(), key, owner, now).run();
      return Number(renewed.meta.changes) === 1;
    },
  };
  try {
    return { acquired: true, value: await run(lease) };
  } finally {
    // An old invocation must never release the new owner's lease after expiry.
    await db.prepare(`DELETE FROM platform_settings
      WHERE key=? AND json_valid(value) AND json_extract(value, '$.owner')=?`)
      .bind(key, owner).run();
  }
}
