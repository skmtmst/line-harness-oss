import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessageWithRequestId = pushMessageWithRequestId;
  },
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const { notifications } = await import('./notifications.js');

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
  instance.route('/', notifications);
  return instance;
}

function json(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function seed(db: SqliteD1) {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO staff_members
      (id, name, email, role, api_key, line_user_id, email_verified_at,
       assigned_line_account_id, account_scope, tenant_id)
    VALUES ('owner-1', 'オーナー', 'owner@example.test', 'owner', 'key-owner',
            'U-owner', '2026-09-07T10:00:00+09:00', 'account-1', 'accounts', 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO staff_members
      (id, name, email, role, api_key, assigned_line_account_id, account_scope, tenant_id)
    VALUES ('staff-2', '未連携スタッフ', 'staff@example.test', 'staff', 'key-staff',
            'account-1', 'accounts', 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO notification_rules
      (id, name, event_type, conditions, channels, line_account_id, is_active)
    VALUES ('rule-1', '新しい予約', 'booking_created', ?, '["dashboard","line"]', 'account-1', 0)
  `).run(JSON.stringify({
    importance: 'important', recipientIds: ['owner-1'], recipientLabel: 'オーナー',
    message: '新しい予約が入りました', dedupeMinutes: 10,
  }));
}

describe('運用者へのお知らせの送信と実行記録', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
    testDb = createTestD1();
    seed(testDb);
  });

  it('受信可能人数をLINE・メール・管理画面に分け、未連携を0人にしない', async () => {
    const response = await app(testDb.db).request(
      '/api/notifications/operator-rules/recipients-preview',
      json({ lineAccountId: 'account-1', channels: ['line'] }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { summary: { staff: 2, canReceive: 1, line: 1, email: 0, dashboard: 0, unavailable: 1 } },
    });
  });

  it('宛先を確認して公開し、同じ発生元をLINEと管理画面へ二重送信しない', async () => {
    const published = await app(testDb.db).request(
      '/api/notifications/operator-rules/rule-1/publish',
      json({ lineAccountId: 'account-1' }),
    );
    expect(published.status).toBe(200);

    const first = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-100', message: '予約を確認してください',
      }),
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      data: { rules: [{ ruleId: 'rule-1', accepted: 2, duplicate: 0 }] },
    });

    const duplicate = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-100', message: '予約を確認してください',
      }),
    );
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { rules: [{ ruleId: 'rule-1', accepted: 0, duplicate: 2 }] },
    });
    const grouped = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({
        lineAccountId: 'account-1', eventType: 'booking_created',
        sourceEventId: 'booking-101', message: '別の予約を確認してください',
      }),
    );
    await expect(grouped.json()).resolves.toMatchObject({
      data: { rules: [{ ruleId: 'rule-1', accepted: 0, duplicate: 2 }] },
    });
    expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
    expect(pushMessageWithRequestId.mock.calls[0]?.[2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(testDb.raw.prepare(`
      SELECT channel, status FROM notification_deliveries ORDER BY channel
    `).all()).toEqual([
      { channel: 'in_app', status: 'provider_accepted' },
      { channel: 'line', status: 'provider_accepted' },
    ]);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notifications`).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare(`SELECT status, grouped_count FROM notification_instances`).get()).toEqual({
      status: 'completed', grouped_count: 2,
    });
  });

  it('本人テスト送信を台帳へ分け、理由付きCSV出力を監査する', async () => {
    const tested = await app(testDb.db).request(
      '/api/notifications/operator-rules/rule-1/test',
      json({ lineAccountId: 'account-1' }),
    );
    expect(tested.status).toBe(200);
    expect(testDb.raw.prepare(`
      SELECT DISTINCT execution_mode FROM notification_deliveries
    `).all()).toEqual([{ execution_mode: 'test' }]);

    const csv = await app(testDb.db).request(
      '/api/notifications/operator-deliveries.csv?lineAccountId=account-1&reason=月次確認',
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('新しい予約');
    const audit = testDb.raw.prepare(`
      SELECT action, detail_json FROM operation_audit WHERE target_kind = 'notification_delivery'
    `).get() as { action: string; detail_json: string };
    expect(audit.action).toBe('exported');
    expect(JSON.parse(audit.detail_json)).toMatchObject({ reason: '月次確認' });
  });
});
