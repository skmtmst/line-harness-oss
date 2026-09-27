import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

const { ecCommerce } = await import('./ec-commerce');

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', owner);
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

function seedEvent(
  db: SqliteD1,
  id: string,
  receivedAt: string,
  overrides: { eventType?: string; status?: string; accountId?: string } = {},
): void {
  db.raw.prepare(`
    INSERT INTO ec_events
      (id, source, external_event_id, event_type, line_account_id, customer_id,
       line_user_id, friend_id, payload, status, received_at, processed_at, updated_at)
    VALUES (?, 'eccube:account-1', ?, ?, ?, 'customer-1', 'user-1', NULL, '{}',
            ?, ?, NULL, ?)
  `).run(
    id,
    `external-${id}`,
    overrides.eventType ?? 'ec.order.confirmed',
    overrides.accountId ?? 'account-1',
    overrides.status ?? 'processed',
    receivedAt,
    receivedAt,
  );
}

describe('EC集計の期間（JST）', () => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('overviewの「今日」はJSTの0時から数える（UTCの直前24時間ではない）', async () => {
    // 2026-09-27 00:30 JST。直前24時間（UTC）には 9/26 23:59 JST が入るが、
    // JSTの「今日」には入らない。
    vi.setSystemTime(new Date('2026-09-26T15:30:00Z'));
    seedEvent(testDb, 'event-yesterday', '2026-09-26T23:59:00+09:00');
    seedEvent(testDb, 'event-today', '2026-09-27T00:00:00+09:00');
    seedEvent(testDb, 'event-other-account', '2026-09-27T01:00:00+09:00', { accountId: 'account-2' });

    const response = await app(testDb.db).request('/api/ec-commerce/overview?lineAccountId=account-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: {
      total: number; last24h: number;
      byType: Array<{ eventType: string; count: number }>;
    } };
    expect(body.success).toBe(true);
    // 累計は両方入るが、「今日」はJST今日の1件だけ。
    expect(body.data.total).toBe(2);
    expect(body.data.last24h).toBe(1);
    expect(body.data.byType).toEqual([
      expect.objectContaining({ eventType: 'ec.order.confirmed', count: 1 }),
    ]);
  });

  it('connectorのhealthもJSTの今日・この30日で数える（月末をまたぐ）', async () => {
    // 2026-10-01 00:30 JST。この30日は 09-02 以降。09-01 23:59 JST は
    // UTCの直前30日には入るが、JSTの30日には入らない。
    vi.setSystemTime(new Date('2026-09-30T15:30:00Z'));
    seedEvent(testDb, 'event-in', '2026-09-02T00:00:00+09:00');
    seedEvent(testDb, 'event-out', '2026-09-01T23:59:00+09:00');
    seedEvent(testDb, 'event-today', '2026-10-01T00:10:00+09:00');

    const response = await app(testDb.db).request('/api/ec-commerce/connector?lineAccountId=account-1');
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: {
      health: { today: number; last30Days: number };
    } };
    expect(body.success).toBe(true);
    expect(body.data.health.today).toBe(1);
    expect(body.data.health.last30Days).toBe(2);
  });
});
