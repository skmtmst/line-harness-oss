import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
const sendOperationEmail = vi.hoisted(() => vi.fn());
const canAccessAllLineAccounts = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessageWithRequestId = pushMessageWithRequestId;
  },
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts,
}));
vi.mock('../services/operation-notifications.js', () => ({ sendOperationEmail }));

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
  const columns = db.raw.prepare(`PRAGMA table_info(notification_rules)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'version')) {
    db.raw.prepare(`ALTER TABLE notification_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)`).run();
  }
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
    sendOperationEmail.mockReset();
    sendOperationEmail.mockResolvedValue(undefined);
    canAccessAllLineAccounts.mockReset();
    canAccessAllLineAccounts.mockResolvedValue(true);
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

  it('他アカウントの自動発火は403で止める', async () => {
    canAccessAllLineAccounts.mockResolvedValueOnce(false);
    const response = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({ lineAccountId: 'account-9', eventType: 'booking_created', sourceEventId: 'x-1' }),
    );
    expect(response.status).toBe(403);
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM notification_instances`).get())
      .toEqual({ count: 0 });
  });

  it('未登録のきっかけは400で止める', async () => {
    const response = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({ lineAccountId: 'account-1', eventType: 'ghost_event', sourceEventId: 'x-1' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false, code: 'unknown_event_type',
    });
  });

  it('登録簿で接続済みと未接続を見分けられる', async () => {
    const response = await app(testDb.db).request(
      '/api/notifications/operator-event-types?lineAccountId=account-1',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        summary: { total: 4, connected: 3, unconnected: 1 },
      },
    });
    const body = await (await app(testDb.db).request(
      '/api/notifications/operator-event-types?lineAccountId=account-1',
    )).json() as { data: { items: Array<{ eventType: string; connected: boolean }> } };
    expect(body.data.items.map((item) => item.eventType).sort()).toEqual([
      'booking_created', 'broadcast_completed', 'ec_order_received', 'form_submitted',
    ]);
    const connected = body.data.items.filter((item) => item.connected).map((item) => item.eventType).sort();
    expect(connected).toEqual(['booking_created', 'broadcast_completed', 'ec_order_received']);
    const unconnected = body.data.items.filter((item) => !item.connected).map((item) => item.eventType).sort();
    expect(unconnected).toEqual(['form_submitted']);
  });

  it('2回目の保存が残り、内容変更で版が上がる', async () => {
    const first = await app(testDb.db).request(
      '/api/notifications/rules/rule-1?lineAccountId=account-1',
    );
    await expect(first.json()).resolves.toMatchObject({ data: { version: 1 } });
    const updated = await app(testDb.db).request(
      '/api/notifications/rules/rule-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineAccountId: 'account-1', name: '新しい予約(改)' }),
      },
    );
    expect(updated.status).toBe(200);
    const reread = await app(testDb.db).request(
      '/api/notifications/rules/rule-1?lineAccountId=account-1',
    );
    await expect(reread.json()).resolves.toMatchObject({
      data: { name: '新しい予約(改)', version: 2 },
    });
  });

  it('自動とテスト送信をCSVの実行区分で区別できる', async () => {
    await app(testDb.db).request(
      '/api/notifications/operator-rules/rule-1/publish',
      json({ lineAccountId: 'account-1' }),
    );
    await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({ lineAccountId: 'account-1', eventType: 'booking_created', sourceEventId: 'booking-csv' }),
    );
    await app(testDb.db).request(
      '/api/notifications/operator-rules/rule-1/test',
      json({ lineAccountId: 'account-1' }),
    );
    const csv = await app(testDb.db).request(
      '/api/notifications/operator-deliveries.csv?lineAccountId=account-1&reason=区別確認',
    );
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toContain('実行区分');
    expect(text).toContain('自動');
    expect(text).toContain('テスト');
  });

  it('確認済みメールを代替経路として送り、実行記録へ残す', async () => {
    testDb.raw.prepare(`UPDATE notification_rules SET channels = '["email"]' WHERE id = 'rule-1'`).run();
    const published = await app(testDb.db).request(
      '/api/notifications/operator-rules/rule-1/publish',
      json({ lineAccountId: 'account-1' }),
    );
    expect(published.status).toBe(200);
    const response = await app(testDb.db).request(
      '/api/notifications/operator-events',
      json({ lineAccountId: 'account-1', eventType: 'booking_created', sourceEventId: 'booking-email' }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { rules: [{ ruleId: 'rule-1', accepted: 1, excluded: 0 }] },
    });
    expect(sendOperationEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      to: 'owner@example.test', subject: '【運用者へのお知らせ】新しい予約',
    }));
    expect(testDb.raw.prepare(`SELECT channel, status FROM notification_deliveries`).get()).toEqual({
      channel: 'email', status: 'provider_accepted',
    });
  });
});
