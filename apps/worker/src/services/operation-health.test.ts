import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'limited', value: 1000 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ totalUsage: 500 }), { status: 200 })));
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
});
