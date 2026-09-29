import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { purgeExpiredAutomationRuns } from '@line-crm/db';

const NOW = new Date('2026-09-25T12:00:00+09:00');

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function seedRun(
  db: SqliteD1,
  id: string,
  status: string,
  createdDaysAgo: number,
  accountId = 'account-1',
): void {
  db.raw.prepare(`
    INSERT INTO automation_runs
      (id, line_account_id, automation_id, automation_version_id, source_event_id,
       idempotency_key, status, created_at)
    VALUES (?, ?, 'auto-1', 'ver-1', ?, ?, ?, ?)
  `).run(id, accountId, `event-${id}`, `key-${id}`, status, isoDaysAgo(createdDaysAgo));
}

function seedStep(db: SqliteD1, id: string, runId: string, status = 'success', stepKey = 'step-1'): void {
  db.raw.prepare(`
    INSERT INTO automation_run_steps
      (id, automation_run_id, step_key, action_type, idempotency_key, status, created_at)
    VALUES (?, ?, ?, 'add_tag', ?, ?, ?)
  `).run(id, runId, stepKey, `stepkey-${id}`, status, isoDaysAgo(100));
}

describe('オートメーション履歴の保持期間', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO automation_definitions (id, line_account_id, name, status)
      VALUES ('auto-1', 'account-1', '自動化1', 'active')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO automation_versions
        (id, automation_id, version_number, status, trigger_type)
      VALUES ('ver-1', 'auto-1', 1, 'published', 'friend_added')
    `).run();
  });

  it('90日を超えた確定済み明細を日別に畳んで消す', async () => {
    seedRun(testDb, 'run-old-success', 'success', 100);
    seedRun(testDb, 'run-old-failed', 'failed', 120);
    seedStep(testDb, 'step-old-1', 'run-old-success');
    seedStep(testDb, 'step-old-2', 'run-old-success', 'failed', 'step-2');
    seedRun(testDb, 'run-new', 'success', 10);
    seedRun(testDb, 'run-old-waiting', 'waiting', 100);

    const purged = await purgeExpiredAutomationRuns(testDb.db, NOW);
    expect(purged.runs).toBe(2);
    expect(purged.steps).toBe(2);
    expect(purged.dailyBuckets).toBe(2);

    const remaining = testDb.raw.prepare(`SELECT id FROM automation_runs ORDER BY id`).all() as Array<{ id: string }>;
    expect(remaining.map((row) => row.id).sort()).toEqual(['run-new', 'run-old-waiting']);
    const stepsLeft = testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_run_steps`).get() as { count: number };
    expect(stepsLeft).toEqual({ count: 0 });

    const buckets = testDb.raw.prepare(`
      SELECT day, status, run_count, step_count FROM automation_run_daily_counts
       ORDER BY day, status
    `).all() as Array<{ day: string; status: string; run_count: number; step_count: number }>;
    expect(buckets).toHaveLength(2);
    expect(buckets.find((row) => row.status === 'success')).toMatchObject({ run_count: 1, step_count: 2 });
    expect(buckets.find((row) => row.status === 'failed')).toMatchObject({ run_count: 1, step_count: 0 });
  });

  it('13か月を超えた日別集計を消す', async () => {
    const oldDay = '2025-01-01';
    testDb.raw.prepare(`
      INSERT INTO automation_run_daily_counts
        (line_account_id, automation_id, day, status, run_count, step_count, created_at, updated_at)
      VALUES ('account-1', 'auto-1', ?, 'success', 5, 10, ?, ?)
    `).run(oldDay, isoDaysAgo(400), isoDaysAgo(400));
    const purged = await purgeExpiredAutomationRuns(testDb.db, NOW);
    expect(purged.dailyExpired).toBe(1);
    const left = testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_run_daily_counts`).get() as { count: number };
    expect(left).toEqual({ count: 0 });
  });

  it('90日ちょうどの明細は残す', async () => {
    seedRun(testDb, 'run-exact', 'success', 90);
    const purged = await purgeExpiredAutomationRuns(testDb.db, NOW);
    expect(purged.runs).toBe(0);
    const left = testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get() as { count: number };
    expect(left).toEqual({ count: 1 });
  });
});
