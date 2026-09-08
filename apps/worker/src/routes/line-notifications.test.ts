import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/line-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/line-sdk')>();
  return {
    ...actual,
    LineClient: class {
      pushMessageWithRequestId = pushMessageWithRequestId;
    },
  };
});

const { lineNotifications } = await import('./line-notifications');

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const staff: AuthenticatedStaff = {
  ...owner, id: 'staff-1', name: '担当者', role: 'staff',
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

function json(method: string, body: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function seedDefinition(db: SqliteD1): void {
  db.raw.prepare(`
    INSERT INTO customer_notification_definitions
      (id, line_account_id, key, name, category, source_event_type, status,
       current_version_id, draft_config_json, version, created_by, updated_by,
       created_at, updated_at)
    VALUES ('definition-1', 'account-1', 'order-confirmed', '注文確定のお知らせ',
            'order', 'ec.order.confirmed', 'published', 'definition-version-1',
            ?, 1, 'owner-1', 'owner-1', '2026-09-07T10:00:00+09:00',
            '2026-09-07T10:00:00+09:00')
  `).run(JSON.stringify({ lineTemplate: [{ type: 'text', text: '注文を受け付けました' }] }));
  db.raw.prepare(`
    INSERT INTO customer_notification_versions
      (id, definition_id, version_number, config_json, line_template_json,
       published_by, published_at)
    VALUES ('definition-version-1', 'definition-1', 1, ?, ?, 'owner-1',
            '2026-09-07T10:00:00+09:00')
  `).run(
    JSON.stringify({ lineTemplate: [{ type: 'text', text: '注文を受け付けました' }] }),
    JSON.stringify([{ type: 'text', text: '注文を受け付けました' }]),
  );
}

function seedDelivery(
  db: SqliteD1,
  id: string,
  status: 'pending' | 'provider_accepted' | 'excluded' | 'retry_wait' | 'failed',
  overrides: { retryable?: number; accountId?: string; version?: number } = {},
): void {
  const accountId = overrides.accountId ?? 'account-1';
  db.raw.prepare(`
    INSERT INTO notification_instances
      (id, line_account_id, audience_type, definition_id, definition_version_id,
       source_event_type, source_event_id, source_metadata_json, dedupe_key,
       status, created_at, updated_at)
    VALUES (?, ?, 'customer', 'definition-1', 'definition-version-1',
            'ec.order.confirmed', ?, '{"orderNumber":"NEN-1001"}', ?, 'pending',
            '2026-09-07T10:00:00+09:00', '2026-09-07T10:00:00+09:00')
  `).run(`instance-${id}`, accountId, `event-${id}`, `dedupe-${id}`);
  db.raw.prepare(`
    INSERT INTO notification_deliveries
      (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, retryable, attempts, provider_status,
       error_message_safe, queued_at, accepted_at, version, updated_at)
    VALUES (?, ?, ?, 'customer', 'friend', 'friend-1', 'line', ?, ?, ?, 1, ?, ?,
            '2026-09-07T10:00:00+09:00', ?, ?, '2026-09-07T10:00:00+09:00')
  `).run(
    id,
    accountId,
    `instance-${id}`,
    `retry-key-${id}`,
    status,
    overrides.retryable ?? 0,
    status,
    status === 'retry_wait' || status === 'failed' ? '一時的な問題です' : null,
    status === 'provider_accepted' ? '2026-09-07T10:00:01+09:00' : null,
    overrides.version ?? 1,
  );
}

describe('V6 LINE notification APIs', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
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
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', display_name: '山田 太郎' });
  });

  it('pending・accepted・excluded・failed を同じ契約とページ情報で返す', async () => {
    seedDefinition(testDb);
    seedDelivery(testDb, 'delivery-pending', 'pending');
    seedDelivery(testDb, 'delivery-accepted', 'provider_accepted');
    seedDelivery(testDb, 'delivery-excluded', 'excluded');
    seedDelivery(testDb, 'delivery-failed', 'retry_wait', { retryable: 1 });
    testDb.raw.prepare(`
      INSERT INTO notification_interactions (id, delivery_id, link_key, clicked_at)
      VALUES ('click-1', 'delivery-accepted', 'detail', '2026-09-07T10:05:00+09:00')
    `).run();

    const response = await app(testDb.db).request(
      '/api/line-notifications/deliveries?lineAccountId=account-1&limit=20&offset=0',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { items: Array<Record<string, unknown>>; summary: Record<string, number>; coverage: Record<string, unknown> };
      pagination: Record<string, number>;
    };
    expect(new Set(body.data.items.map((item) => item.status))).toEqual(
      new Set(['pending', 'accepted', 'excluded', 'failed']),
    );
    expect(body.data.summary).toEqual({ accepted: 1, failed: 1, excluded: 1, pending: 1 });
    expect(body.data.coverage).toMatchObject({
      source: 'notification_delivery_ledger', attemptHistoryAvailable: true, retryAvailable: true,
    });
    expect(body.pagination).toEqual({ total: 4, limit: 20, offset: 0 });
    expect(body.data.items.find((item) => item.status === 'accepted')).toMatchObject({
      friendName: '山田 太郎', orderNumber: 'NEN-1001', version: 1,
      clickedAt: '2026-09-07T10:05:00+09:00',
    });
    expect(JSON.stringify(body)).not.toMatch(/届きました|開きました|既読/);
  });

  it('空のアカウントは0件、別統括のアカウントは403にする', async () => {
    const empty = await app(testDb.db).request(
      '/api/line-notifications/deliveries?lineAccountId=account-1',
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { items: [], summary: { accepted: 0, failed: 0, excluded: 0, pending: 0 } },
      pagination: { total: 0 },
    });
    const forbidden = await app(testDb.db).request(
      '/api/line-notifications/deliveries?lineAccountId=account-2',
    );
    expect(forbidden.status).toBe(403);
  });

  it('下書きを楽観ロックし、公開済み版を変えずに新版を作る', async () => {
    const createdResponse = await app(testDb.db).request(
      '/api/line-notifications/customer-definitions',
      json('POST', {
        lineAccountId: 'account-1', key: 'shipping', name: '発送のお知らせ',
        category: 'shipping', sourceEventType: 'ec.order.shipped',
        draft: { lineTemplate: [{ type: 'text', text: '発送しました' }] },
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { data: { id: string; version: number } };

    const publishedResponse = await app(testDb.db).request(
      `/api/line-notifications/customer-definitions/${created.data.id}/publish`,
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(publishedResponse.status).toBe(200);
    await expect(publishedResponse.json()).resolves.toMatchObject({
      data: { status: 'published', version: 2, currentVersionNumber: 1 },
    });

    const conflict = await app(testDb.db).request(
      `/api/line-notifications/customer-definitions/${created.data.id}/draft`,
      json('PATCH', {
        lineAccountId: 'account-1', expectedVersion: 1, name: '古い更新',
        category: 'shipping', sourceEventType: 'ec.order.shipped', draft: {},
      }),
    );
    expect(conflict.status).toBe(409);

    const updated = await app(testDb.db).request(
      `/api/line-notifications/customer-definitions/${created.data.id}/draft`,
      json('PATCH', {
        lineAccountId: 'account-1', expectedVersion: 2, name: '発送のお知らせ',
        category: 'shipping', sourceEventType: 'ec.order.shipped',
        draft: { lineTemplate: [{ type: 'text', text: '新しい発送文面' }] },
      }),
    );
    expect(updated.status).toBe(200);
    const republished = await app(testDb.db).request(
      `/api/line-notifications/customer-definitions/${created.data.id}/publish`,
      json('POST', { lineAccountId: 'account-1', expectedVersion: 3 }),
    );
    expect(republished.status).toBe(200);
    const detail = await app(testDb.db).request(
      `/api/line-notifications/customer-definitions/${created.data.id}?lineAccountId=account-1`,
    );
    const body = await detail.json() as { data: { currentVersionNumber: number; versions: Array<{ versionNumber: number; config: { lineTemplate: Array<{ text: string }> } }> } };
    expect(body.data.currentVersionNumber).toBe(2);
    expect(body.data.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(body.data.versions[1].config.lineTemplate[0].text).toBe('発送しました');
  });

  it('一時失敗だけを同じ retry key で再試行し、版違いの二重操作を409にする', async () => {
    seedDefinition(testDb);
    seedDelivery(testDb, 'delivery-retry', 'retry_wait', { retryable: 1 });
    const response = await app(testDb.db).request(
      '/api/line-notifications/deliveries/delivery-retry/retry',
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(response.status).toBe(200);
    expect(pushMessageWithRequestId).toHaveBeenCalledWith(
      'Ufriend-1',
      [{ type: 'text', text: '注文を受け付けました' }],
      'retry-key-delivery-retry',
    );
    expect(testDb.raw.prepare(`
      SELECT status, attempts, provider_request_id, execution_mode, version
        FROM notification_deliveries WHERE id = 'delivery-retry'
    `).get()).toEqual({
      status: 'provider_accepted', attempts: 2, provider_request_id: 'line-request-1',
      execution_mode: 'retry', version: 2,
    });
    expect(testDb.raw.prepare(`
      SELECT retry_key, outcome FROM notification_delivery_attempts
       WHERE delivery_id = 'delivery-retry'
    `).get()).toEqual({ retry_key: 'retry-key-delivery-retry', outcome: 'provider_accepted' });

    const duplicate = await app(testDb.db).request(
      '/api/line-notifications/deliveries/delivery-retry/retry',
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(duplicate.status).toBe(409);
    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
  });

  it('恒久失敗とstaffの手動再試行を拒否する', async () => {
    seedDefinition(testDb);
    seedDelivery(testDb, 'delivery-permanent', 'failed', { retryable: 0 });
    const unavailable = await app(testDb.db).request(
      '/api/line-notifications/deliveries/delivery-permanent/retry',
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(unavailable.status).toBe(409);
    const noPermission = await app(testDb.db, staff).request(
      '/api/line-notifications/deliveries/delivery-permanent/retry',
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(noPermission.status).toBe(403);
    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
  });

  it('LINE公式集計が取得不能のとき0を作らず null と理由を返す', async () => {
    seedDefinition(testDb);
    testDb.raw.prepare(`
      INSERT INTO notification_aggregate_metrics
        (id, line_account_id, definition_id, metric_date, aggregation_unit,
         accepted_count, display_count, click_count, state, reason, updated_at)
      VALUES ('metric-1', 'account-1', 'definition-1', '2026-09-07', 'order_20260907',
              12, NULL, 2, 'unavailable_privacy', NULL, '2026-09-07T12:00:00+09:00')
    `).run();
    const response = await app(testDb.db).request(
      '/api/line-notifications/metrics?lineAccountId=account-1&from=2026-09-01&to=2026-09-07',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          accepted: { value: 12 },
          displayed: { state: 'unavailable', value: null, reason: expect.any(String) },
          clicked: { value: 2 },
        }],
        coverage: { individualOpenAvailable: false, lineAggregateOnly: true, unavailableIsNull: true },
      },
    });
  });

  it('中1: 集計待ちはpendingに寄せて返し、DBの生値は出さない', async () => {
    seedDefinition(testDb);
    testDb.raw.prepare(`
      INSERT INTO notification_aggregate_metrics
        (id, line_account_id, definition_id, metric_date, aggregation_unit,
         accepted_count, display_count, click_count, state, reason, updated_at)
      VALUES ('metric-waiting', 'account-1', 'definition-1', '2026-09-07', 'order_20260907',
              5, NULL, 0, 'waiting', '集計中です', '2026-09-07T12:00:00+09:00')
    `).run();
    const response = await app(testDb.db).request(
      '/api/line-notifications/metrics?lineAccountId=account-1&from=2026-09-01&to=2026-09-07',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ displayed: { state: 'pending', value: null } }],
      },
    });
  });

  it('中2: 記録の実行モードは実応答のまま返す', async () => {
    seedDefinition(testDb);
    seedDelivery(testDb, 'delivery-mode', 'retry_wait', { retryable: 1 });
    const retried = await app(testDb.db).request(
      '/api/line-notifications/deliveries/delivery-mode/retry',
      json('POST', { lineAccountId: 'account-1', expectedVersion: 1 }),
    );
    expect(retried.status).toBe(200);
    const listed = await app(testDb.db).request(
      '/api/line-notifications/deliveries?lineAccountId=account-1&view=all&limit=20&offset=0',
    );
    expect(listed.status).toBe(200);
    const body = await listed.json() as {
      data: { items: Array<{ id: string; executionMode: string; channel: string }> };
    };
    expect(body.data.items.find((item) => item.id === 'delivery-mode')).toMatchObject({
      executionMode: 'retry',
      channel: 'line',
    });
  });
});
