import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  finishOperationDispatcherHeartbeat,
  startOperationDispatcherHeartbeat,
} from '@line-crm/db';
import { DELIVERY_DISPATCH_JOB_NAMES } from './feature-enforcement.js';
import {
  collectOperationDispatchHealth,
  observeOperationDispatcher,
  OPERATION_DISPATCH_JOB_CROSSWALK,
} from './operation-dispatch-health.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const NOW = '2026-09-15T03:00:00.000Z';
const TWO_HOURS_AGO = '2026-09-15T01:00:00.000Z';

type DispatchValue = {
  pendingCount: number;
  deadCount: number;
  oldestAt: string | null;
  delayMinutes: number;
  missingHeartbeatCount: number;
  unknownJobs: string[];
  dispatchers: Array<{
    jobName: string;
    status: string;
    states: { queued: number; sending: number; retrying: number; dead: number };
  }>;
};

describe('operation dispatch health', () => {
  let testDb: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', 'LINE 1', 'token-1', 'secret-1'),
              ('account-2', 'channel-2', 'LINE 2', 'token-2', 'secret-2')`,
    ).run();
  });

  async function markAllFresh(): Promise<void> {
    for (const jobName of DELIVERY_DISPATCH_JOB_NAMES) {
      await startOperationDispatcherHeartbeat(testDb.db, jobName, NOW);
      await finishOperationDispatcherHeartbeat(testDb.db, jobName, 'succeeded', NOW);
    }
  }

  function valueOf(result: Awaited<ReturnType<typeof collectOperationDispatchHealth>>): DispatchValue {
    return result.value as unknown as DispatchValue;
  }

  it('crosswalkの表と列をbootstrap実スキーマへ機械照合する', () => {
    expect(OPERATION_DISPATCH_JOB_CROSSWALK.map(({ jobName }) => jobName))
      .toEqual(DELIVERY_DISPATCH_JOB_NAMES);
    for (const job of OPERATION_DISPATCH_JOB_CROSSWALK) {
      for (const source of job.sources) {
        const columns = testDb.raw.prepare(`PRAGMA table_info(${source.table})`).all()
          .map((row) => (row as { name: string }).name);
        expect(columns, `${job.jobName}: ${source.table}`).toEqual(
          expect.arrayContaining([...source.requiredColumns]),
        );
      }
    }
  });

  it('空データでも全heartbeatが新しければnormalにする', async () => {
    await markAllFresh();
    const result = await collectOperationDispatchHealth(testDb.db, 'account-1', NOW);
    expect(result.status).toBe('normal');
    expect(valueOf(result)).toMatchObject({
      pendingCount: 0,
      deadCount: 0,
      oldestAt: null,
      delayMinutes: 0,
      missingHeartbeatCount: 0,
      unknownJobs: [],
    });
  });

  it('queued/sending/retrying/deadを実DBから状態別に数える', async () => {
    await markAllFresh();
    const insert = testDb.raw.prepare(
      `INSERT INTO reminder_delivery_runs
         (id, line_account_id, reminder_id, friend_reminder_id, friend_id, reminder_step_id,
          scheduled_at, idempotency_key, line_retry_key, status, next_retry_at, started_at,
          created_at, updated_at)
       VALUES (?, 'account-1', 'reminder-1', ?, 'friend-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [id, status] of [
      ['queued-1', 'queued'],
      ['sending-1', 'claimed'],
      ['retrying-1', 'retry_wait'],
      ['dead-1', 'permanent_failed'],
    ] as const) {
      insert.run(
        id, `friend-reminder-${id}`, `step-${id}`, TWO_HOURS_AGO,
        `idempotency-${id}`, `retry-${id}`, status,
        status === 'retry_wait' ? TWO_HOURS_AGO : null,
        status === 'claimed' ? TWO_HOURS_AGO : null,
        TWO_HOURS_AGO, TWO_HOURS_AGO,
      );
    }
    const result = await collectOperationDispatchHealth(testDb.db, 'account-1', NOW);
    const reminder = valueOf(result).dispatchers.find(({ jobName }) => jobName === 'reminder deliveries');
    expect(reminder?.states).toEqual({ queued: 1, sending: 1, retrying: 1, dead: 1 });
    expect(result.status).toBe('danger');
    expect(valueOf(result)).toMatchObject({ pendingCount: 3, deadCount: 1, delayMinutes: 120 });
  });

  it('automation以外のbroadcast遅延を検知し、別accountは混ぜない', async () => {
    await markAllFresh();
    const insert = testDb.raw.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, status, scheduled_at,
          created_at, line_account_id, account_ids)
       VALUES (?, ?, 'text', '{}', ?, 'scheduled', ?, ?, ?, ?)`,
    );
    insert.run('broadcast-1', '対象', 'all', TWO_HOURS_AGO, TWO_HOURS_AGO, 'account-1', null);
    insert.run('broadcast-2', '対象外', 'all', TWO_HOURS_AGO, TWO_HOURS_AGO, 'account-2', null);
    insert.run('broadcast-3', '複数account対象', 'multi-account-dedup', TWO_HOURS_AGO,
      TWO_HOURS_AGO, null, JSON.stringify(['account-2']));

    const account1 = await collectOperationDispatchHealth(testDb.db, 'account-1', NOW);
    const account2 = await collectOperationDispatchHealth(testDb.db, 'account-2', NOW);
    expect(valueOf(account1).dispatchers.find(({ jobName }) => jobName === 'broadcast deliveries')?.states.queued)
      .toBe(1);
    expect(valueOf(account2).dispatchers.find(({ jobName }) => jobName === 'broadcast deliveries')?.states.queued)
      .toBe(2);
    expect(account1.status).toBe('danger');
  });

  it('heartbeat欠落と未知jobをnormalにしない', async () => {
    await markAllFresh();
    testDb.raw.prepare(
      `DELETE FROM operation_dispatcher_heartbeats WHERE job_name = 'broadcast deliveries'`,
    ).run();
    const missing = await collectOperationDispatchHealth(testDb.db, 'account-1', NOW);
    expect(missing.status).toBe('danger');
    expect(valueOf(missing).missingHeartbeatCount).toBe(1);

    await startOperationDispatcherHeartbeat(testDb.db, 'unknown delivery', NOW);
    await finishOperationDispatcherHeartbeat(testDb.db, 'unknown delivery', 'succeeded', NOW);
    const unknown = await collectOperationDispatchHealth(testDb.db, 'account-1', NOW);
    expect(unknown.status).toBe('unknown');
    expect(valueOf(unknown).unknownJobs).toEqual(['unknown delivery']);
  });

  it('dispatcher成否をheartbeatへ残し、元処理の例外を維持する', async () => {
    await expect(observeOperationDispatcher(
      testDb.db, 'broadcast deliveries', async () => 'ok', NOW,
    )).resolves.toBe('ok');
    expect(testDb.raw.prepare(
      `SELECT last_status FROM operation_dispatcher_heartbeats WHERE job_name = 'broadcast deliveries'`,
    ).get()).toEqual({ last_status: 'succeeded' });

    await expect(observeOperationDispatcher(
      testDb.db, 'broadcast deliveries', async () => { throw new Error('dispatch_failed'); }, NOW,
    )).rejects.toThrow('dispatch_failed');
    expect(testDb.raw.prepare(
      `SELECT last_status FROM operation_dispatcher_heartbeats WHERE job_name = 'broadcast deliveries'`,
    ).get()).toEqual({ last_status: 'failed' });
  });

  it('重なった古い実行の完了で新しいheartbeatを上書きしない', async () => {
    const first = '2026-09-15T03:00:00.000Z';
    const second = '2026-09-15T03:05:00.000Z';
    await startOperationDispatcherHeartbeat(testDb.db, 'broadcast deliveries', first);
    await startOperationDispatcherHeartbeat(testDb.db, 'broadcast deliveries', second);
    await finishOperationDispatcherHeartbeat(
      testDb.db, 'broadcast deliveries', 'failed', '2026-09-15T03:06:00.000Z', first,
    );
    expect(testDb.raw.prepare(
      `SELECT last_started_at, last_status
         FROM operation_dispatcher_heartbeats WHERE job_name = 'broadcast deliveries'`,
    ).get()).toEqual({ last_started_at: second, last_status: 'running' });
  });

  it('heartbeat保存だけが失敗しても既存dispatcherは実行する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    testDb.raw.exec('DROP TABLE operation_dispatcher_heartbeats');
    await expect(observeOperationDispatcher(
      testDb.db, 'broadcast deliveries', async () => 'sent', NOW,
    )).resolves.toBe('sent');
  });
});
