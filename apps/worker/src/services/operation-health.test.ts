import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeOperationHealthAlert, listOperationHealthAlerts } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { runOperationHealthChecks } from './operation-health.js';

let testDb: ReturnType<typeof createTestD1>;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO friend_daily_snapshots
       (date, line_account_id, active, total, added, blocked)
     VALUES ('2026-08-28', '', 100, 100, 2, 1)`,
  ).run();
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => Promise.resolve(
    new Response(
      JSON.stringify(String(input).includes('/consumption') ? { totalUsage: 500 } : { type: 'limited', value: 1000 }),
      { status: 200 },
    ),
  )));
});

afterEach(() => vi.unstubAllGlobals());

describe('運用状態の保存監視', () => {
  it('5項目を同じ実行として保存し、同じ5分枠では二重実行しない', async () => {
    const env = { DB: testDb.db } as Parameters<typeof runOperationHealthChecks>[0];
    const now = new Date('2026-08-28T01:00:00.000Z');
    const first = await runOperationHealthChecks(env, now);
    const second = await runOperationHealthChecks(env, new Date('2026-08-28T01:04:59.000Z'));

    expect(first?.results).toHaveLength(5);
    expect(first?.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkKey: 'quota', severity: 'normal' }),
      expect.objectContaining({ checkKey: 'api', severity: 'normal' }),
      expect.objectContaining({ checkKey: 'webhook', severity: 'normal' }),
      expect.objectContaining({ checkKey: 'delivery', severity: 'normal' }),
      expect.objectContaining({ checkKey: 'friends', severity: 'normal' }),
    ]));
    expect(second?.runId).toBe(first?.runId);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('外部APIを取得できない項目だけ未確認にし、残りは保存する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const snapshot = await runOperationHealthChecks(
      { DB: testDb.db } as Parameters<typeof runOperationHealthChecks>[0],
      new Date('2026-08-28T01:10:00.000Z'),
    );
    expect(snapshot?.results).toHaveLength(5);
    expect(snapshot?.results.find((item) => item.checkKey === 'quota')).toMatchObject({ severity: 'unknown' });
    expect(snapshot?.results.find((item) => item.checkKey === 'api')).toMatchObject({ severity: 'normal' });
  });

  it('同じ異常を1件へ束ね、確認済みのまま正常復帰で解決する', async () => {
    testDb.raw.prepare(
      `INSERT INTO outgoing_webhooks (id, name, url, is_active, secret, consecutive_failures)
       VALUES ('hook-1', '通知', 'https://example.test', 1, NULL, 0)`,
    ).run();
    const env = { DB: testDb.db } as Parameters<typeof runOperationHealthChecks>[0];
    await runOperationHealthChecks(env, new Date('2026-08-28T01:20:00.000Z'));
    await runOperationHealthChecks(env, new Date('2026-08-28T01:25:00.000Z'));
    let alerts = await listOperationHealthAlerts(testDb.db);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ checkKey: 'webhook', status: 'open', severity: 'danger' });

    const acknowledged = await acknowledgeOperationHealthAlert(testDb.db, {
      alertId: alerts[0]!.id,
      actorId: 'admin-1',
      now: '2026-08-28T01:26:00.000Z',
    });
    expect(acknowledged).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'admin-1' });

    testDb.raw.prepare("UPDATE outgoing_webhooks SET secret = 'signed' WHERE id = 'hook-1'").run();
    await runOperationHealthChecks(env, new Date('2026-08-28T01:30:00.000Z'));
    alerts = await listOperationHealthAlerts(testDb.db, { includeResolved: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: 'resolved', acknowledgedBy: 'admin-1' });
  });
});
