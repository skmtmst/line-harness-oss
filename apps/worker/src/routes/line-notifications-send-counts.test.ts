import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

const { lineNotifications } = await import('./line-notifications');

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const otherOwner: AuthenticatedStaff = {
  id: 'owner-2', name: '別統括', role: 'owner', readOnly: false, tenantId: 'tenant-2',
};

function app(db: D1Database, actor: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  instance.route('/', lineNotifications);
  return instance;
}

function seedDefinition(db: SqliteD1): void {
  db.raw.prepare(`
    INSERT INTO customer_notification_definitions
      (id, line_account_id, key, name, category, source_event_type, status,
       current_version_id, draft_config_json, version, created_by, updated_by,
       created_at, updated_at)
    VALUES ('definition-1', 'account-1', 'order-confirmed', '注文確定のお知らせ',
            'order', 'ec.order.confirmed', 'published', 'definition-version-1',
            '{}', 1, 'owner-1', 'owner-1', '2026-09-07T10:00:00+09:00',
            '2026-09-07T10:00:00+09:00')
  `).run();
}

function seedDelivery(
  db: SqliteD1,
  id: string,
  input: {
    acceptedAt: string | null;
    status?: 'provider_accepted' | 'failed' | 'pending';
    audience?: 'customer' | 'operator';
    mode?: 'automatic' | 'test';
    accountId?: string;
    eventType?: string;
  },
): void {
  const accountId = input.accountId ?? 'account-1';
  const audience = input.audience ?? 'customer';
  const status = input.status ?? 'provider_accepted';
  db.raw.prepare(`
    INSERT INTO notification_instances
      (id, line_account_id, audience_type, definition_id,
       source_event_type, source_event_id, dedupe_key,
       status, created_at, updated_at)
    VALUES (?, ?, ?, 'definition-1', ?, ?, ?, 'completed',
            '2026-09-07T10:00:00+09:00', '2026-09-07T10:00:00+09:00')
  `).run(`instance-${id}`, accountId, audience, input.eventType ?? 'ec.order.confirmed', `event-${id}`, `dedupe-${id}`);
  db.raw.prepare(`
    INSERT INTO notification_deliveries
      (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, retryable, attempts,
       queued_at, accepted_at, execution_mode, version, updated_at)
    VALUES (?, ?, ?, ?, 'friend', 'friend-1', 'line', ?, ?, 0, 1,
            '2026-09-07T10:00:00+09:00', ?, ?, 1, '2026-09-07T10:00:00+09:00')
  `).run(
    id, accountId, `instance-${id}`, audience, `retry-key-${id}`, status,
    input.acceptedAt, input.mode ?? 'automatic',
  );
}

type SendCounts = {
  sentToday: number;
  sentLast30d: number;
  byEventType: Array<{ eventType: string; today: number; last30d: number }>;
  period: { today: string; from30d: string; to: string };
};

describe('LINE通知の送信件数（JSTの今日・この30日）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    vi.useFakeTimers();
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
    `).run();
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2')
    `).run();
    seedDefinition(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('受け付け済みの顧客送信だけをJSTの今日・30日で数える', async () => {
    // 2026-09-27 00:30 JST。前日 23:59 の送信は「今日」に入らない。
    vi.setSystemTime(new Date('2026-09-26T15:30:00Z'));
    seedDelivery(testDb, 'd-today', { acceptedAt: '2026-09-27T00:05:00+09:00' });
    seedDelivery(testDb, 'd-yesterday', { acceptedAt: '2026-09-26T23:59:00+09:00' });
    seedDelivery(testDb, 'd-old', { acceptedAt: '2026-08-28T12:00:00+09:00' });
    seedDelivery(testDb, 'd-edge', { acceptedAt: '2026-08-29T00:00:00+09:00', eventType: 'ec.order.shipped' });
    // 数えないもの：試し送り・失敗・ 運用者宛・別アカウント。
    seedDelivery(testDb, 'd-test', { acceptedAt: '2026-09-27T00:06:00+09:00', mode: 'test' });
    seedDelivery(testDb, 'd-failed', { acceptedAt: null, status: 'failed' });
    seedDelivery(testDb, 'd-operator', { acceptedAt: '2026-09-27T00:07:00+09:00', audience: 'operator' });
    seedDelivery(testDb, 'd-other', { acceptedAt: '2026-09-27T00:08:00+09:00', accountId: 'account-2' });

    const response = await app(testDb.db).request('/api/line-notifications/send-counts?lineAccountId=account-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: SendCounts };
    expect(body.success).toBe(true);
    expect(body.data.sentToday).toBe(1);
    expect(body.data.sentLast30d).toBe(3);
    expect(body.data.byEventType).toEqual([
      { eventType: 'ec.order.confirmed', today: 1, last30d: 2 },
      { eventType: 'ec.order.shipped', today: 0, last30d: 1 },
    ]);
    expect(body.data.period).toEqual({ today: '2026-09-27', from30d: '2026-08-29', to: '2026-09-27' });
  });

  it('WEB198 counts delivery failures, not event failures or retry attempts, and clears recovered deliveries', async () => {
    seedDelivery(testDb, 'fail', { acceptedAt: null, status: 'failed' });
    seedDelivery(testDb, 'retry', { acceptedAt: null, status: 'pending' });
    testDb.raw.exec("UPDATE notification_deliveries SET status='retry_wait',attempts=7 WHERE id='retry'");
    for (const [id, audience, mode, accountId] of [
      ['operator','operator','automatic','account-1'], ['test','customer','test','account-1'], ['foreign','customer','automatic','account-2'],
    ] as const) seedDelivery(testDb,id,{ acceptedAt:null,status:'failed',audience,mode,accountId });
    seedDelivery(testDb,'excluded',{acceptedAt:null,status:'pending'});
    testDb.raw.exec("UPDATE notification_deliveries SET status='excluded' WHERE id='excluded'");
    const get = async () => (await (await app(testDb.db).request('/api/line-notifications/send-counts?lineAccountId=account-1')).json()) as { data: { failures: { scope: string; total: number; failed: number; retryWaiting: number } } };
    expect((await get()).data.failures).toEqual({ scope: 'all_time_unresolved', total: 2, failed: 1, retryWaiting: 1 });
    testDb.raw.exec("UPDATE notification_deliveries SET status='provider_accepted' WHERE id='retry'");
    expect((await get()).data.failures.total).toBe(1);
  });

  it('月末をまたいでもJSTの暦日で切る', async () => {
    // 2026-10-01 00:30 JST。この30日は 09-02 以降。
    vi.setSystemTime(new Date('2026-09-30T15:30:00Z'));
    seedDelivery(testDb, 'd-in', { acceptedAt: '2026-09-02T00:00:00+09:00' });
    seedDelivery(testDb, 'd-out', { acceptedAt: '2026-09-01T23:59:00+09:00' });
    seedDelivery(testDb, 'd-today', { acceptedAt: '2026-10-01T00:10:00+09:00' });

    const response = await app(testDb.db).request('/api/line-notifications/send-counts?lineAccountId=account-1');
    const body = await response.json() as { success: boolean; data: SendCounts };
    expect(body.success).toBe(true);
    expect(body.data.sentToday).toBe(1);
    expect(body.data.sentLast30d).toBe(2);
  });

  it('アカウント未指定は400、権限のないアカウントは403', async () => {
    const missing = await app(testDb.db).request('/api/line-notifications/send-counts');
    expect(missing.status).toBe(400);
    const forbidden = await app(testDb.db, otherOwner)
      .request('/api/line-notifications/send-counts?lineAccountId=account-1');
    expect(forbidden.status).toBe(403);
  });
});
