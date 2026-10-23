import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../worker-env.js';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { handleUberWebhook } from './webhook.js';

const token = vi.hoisted(() => vi.fn(async () => ({
  accessToken: 'test-application-token', scope: ['eats.order', 'eats.store.orders.read'], expiresAtMs: 9_999_999_999_999,
})));
vi.mock('./application-token.js', () => ({ getUberApplicationToken: token }));

const TENANT = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-22T01:00:00Z');
let database: SqliteD1;
let env: Env['Bindings'];
let fetcher: ReturnType<typeof vi.fn>;

function notification(eventId = 'event-one', orderId = 'order-one', eventType = 'orders.notification') {
  return { event_id: eventId, event_type: eventType, meta: { resource_id: orderId, user_id: 'uber-store' },
    resource_href: 'https://untrusted.invalid/must-not-fetch' };
}

function details(orderId = 'order-one') {
  return { id: orderId, display_id: '#123', current_state: 'CREATED', store: { id: 'uber-store' },
    placed_at: NOW.toISOString(), type: 'DELIVERY_BY_UBER',
    cart: { items: [
      { instance_id: 'line-one', title: '弁当', quantity: 2, price: { unit_price: { amount: 800, currency_code: 'JPY' } } },
      { instance_id: 'line-two', title: '味噌汁', quantity: 1, price: { unit_price: { amount: 200, currency_code: 'JPY' } } },
    ] }, payment: { charges: { total: { amount: 1800, currency_code: 'JPY' } } } };
}

async function send(body = notification()): Promise<Response> {
  const app = new Hono<Env>();
  app.post('/hook', async c => {
    const rawBody = await c.req.text();
    return handleUberWebhook(c, JSON.parse(rawBody), rawBody, Math.floor(Date.now() / 1000));
  });
  return app.request('/hook', { method: 'POST', body: JSON.stringify(body) }, env);
}

function row(table: string) {
  return database.raw.prepare(`SELECT * FROM ${table}`).get() as Record<string, unknown> | undefined;
}

beforeEach(() => {
  token.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  database = createTestD1();
  database.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]', status = 'active' WHERE id = ?`).run(TENANT);
  database.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-one', 'channel-one', '店舗', 'fixture-token', 'fixture-secret', 1, ?)`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name)
    VALUES ('organization-one', 'account-one', ?, '統括')`).run(TENANT);
  database.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, area, capacity, status, line_account_id)
    VALUES ('store-one', 'organization-one', '店舗', 'ONE', '東京', 20, 'active', 'account-one')`).run();
  database.raw.prepare(`INSERT INTO rt_delivery_uber_connections
    (store_id, account_id, uber_store_id, status, provisioned_at, version, created_at, updated_at)
    VALUES ('store-one', 'account-one', 'uber-store', 'connected', ?, 1, ?, ?)`)
    .run(NOW.getTime(), NOW.getTime(), NOW.getTime());
  env = { DB: database.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true', RT_DELIVERY_SEND_ENABLED: 'true',
    RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox', RT_DELIVERY_UBEREATS_CLIENT_ID: 'fixture-client',
    RT_DELIVERY_UBEREATS_CLIENT_SECRET: 'fixture-secret', WORKER_PUBLIC_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } as unknown as Env['Bindings'];
  fetcher = vi.fn(async () => Response.json(details()));
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  database.raw.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Uber標準通知の受信と保存', () => {
  it('詳細を固定URLから読み、注文と全品目を保存して空の200を返す', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://test-api.uber.com/v2/eats/order/order-one');
    expect(row('rt_delivery_orders')).toMatchObject({ store_id: 'store-one', account_id: 'account-one', status: 'new', item_count: 3, total_amount: 1800 });
    expect(database.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_order_items').get()).toEqual({ n: 2 });
    expect(row('rt_delivery_events')).toMatchObject({ status: 'processed', attempts: 1 });
  });

  it('同一通知と別通知の同一注文を重ねても、取得・注文・品目を増やさない', async () => {
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send(notification('event-two'))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(database.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_orders').get()).toEqual({ n: 1 });
    expect(database.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_order_items').get()).toEqual({ n: 2 });
  });

  it('処理済みevent IDを別注文へ流用しても200で受け付けない', async () => {
    await send();
    expect((await send(notification('event-one', 'different-order'))).status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('別店舗の同じ外部注文IDを取り込まない', async () => {
    await send();
    database.raw.prepare(`UPDATE rt_delivery_orders SET store_id = 'other-store'`).run();
    expect((await send()).status).toBe(409);
    expect((await send(notification('event-two'))).status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('品目保存失敗で注文も巻き戻し、同じ通知を再処理できる', async () => {
    database.raw.exec(`CREATE TRIGGER fail_item BEFORE INSERT ON rt_delivery_order_items
      BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END;`);
    expect((await send()).status).toBe(503);
    expect(row('rt_delivery_orders')).toBeUndefined();
    expect(row('rt_delivery_order_items')).toBeUndefined();
    expect(row('rt_delivery_events')).toMatchObject({ status: 'retryable_failed', attempts: 1 });
    database.raw.exec('DROP TRIGGER fail_item');
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await send()).status).toBe(200);
    expect(row('rt_delivery_events')).toMatchObject({ status: 'processed', attempts: 2 });
    expect(database.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_order_items').get()).toEqual({ n: 2 });
  });

  it('送信停止中は取得せず、残ったreceivedを有効化後に回収する', async () => {
    env.RT_DELIVERY_SEND_ENABLED = 'false';
    expect((await send()).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(row('rt_delivery_events')).toMatchObject({ status: 'received', attempts: 0 });
    env.RT_DELIVERY_SEND_ENABLED = 'true';
    expect((await send()).status).toBe(200);
  });

  it('結果待ちのlockは503、期限切れreceivedは再処理する', async () => {
    env.RT_DELIVERY_SEND_ENABLED = 'false';
    await send();
    env.RT_DELIVERY_SEND_ENABLED = 'true';
    database.raw.prepare('INSERT INTO rt_resource_locks(resource_key, owner_token, expires_at) VALUES (?, ?, ?)')
      .run('uber-webhook-order:order-one', 'old-owner', new Date(NOW.getTime() + 60_000).toISOString());
    expect((await send()).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await send()).status).toBe(200);
  });

  it('取得中にlock所有者が変わった処理は保存も他者のlock削除もしない', async () => {
    fetcher.mockImplementationOnce(async () => {
      database.raw.prepare(`UPDATE rt_resource_locks SET owner_token = 'replacement-owner'
        WHERE resource_key = 'uber-webhook-order:order-one'`).run();
      return Response.json(details());
    });
    expect((await send()).status).toBe(503);
    expect(row('rt_delivery_orders')).toBeUndefined();
    expect(database.raw.prepare(`SELECT owner_token FROM rt_resource_locks
      WHERE resource_key = 'uber-webhook-order:order-one'`).get()).toEqual({ owner_token: 'replacement-owner' });
  });

  it('一時失敗は1分・5分・30分を待ち、詳細GETを合計4回で止める', async () => {
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    for (const elapsed of [0, 61, 362, 2163]) {
      vi.setSystemTime(new Date(NOW.getTime() + elapsed * 1000));
      expect((await send()).status).toBe(503);
      const count = fetcher.mock.calls.length;
      expect((await send()).status).toBe(503);
      expect(fetcher).toHaveBeenCalledTimes(count);
    }
    vi.setSystemTime(new Date(NOW.getTime() + 100_000_000));
    expect((await send()).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    `UPDATE tenants SET status = 'suspended'`,
    `UPDATE rt_organizations SET status = 'archived'`,
    `UPDATE tenants SET feature_packs = '[]'`,
    `UPDATE line_accounts SET is_active = 0`,
    `UPDATE line_accounts SET archived_at = '2026-10-22T00:00:00Z'`,
    `UPDATE rt_stores SET status = 'paused'`,
    `INSERT INTO rt_store_feature_flags(store_id, feature, enabled, created_at, updated_at)
      VALUES ('store-one', 'delivery', 0, 1, 1)`,
    `UPDATE rt_delivery_uber_connections SET account_id = 'other-account'`,
    `UPDATE rt_delivery_uber_connections SET status = 'pending_store'`,
    `UPDATE rt_delivery_uber_connections SET last_error = 'pos_activation_unknown'`,
  ])('所属・有効設定が合わなければ取り込まない: %s', async sql => {
    database.raw.exec(sql);
    expect((await send()).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(row('rt_delivery_events')).toBeUndefined();
  });

  it('同じUber店舗に接続が複数あれば曖昧なまま取り込まない', async () => {
    database.raw.prepare(`INSERT INTO rt_delivery_uber_connections
      (store_id, account_id, uber_store_id, status, provisioned_at, created_at, updated_at)
      VALUES ('other-store', 'account-one', 'uber-store', 'connected', 1, 1, 1)`).run();
    expect((await send()).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('詳細の注文IDや店舗IDが違えば保存しない', async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ ...details(), store: { id: 'another-store' } }));
    expect((await send()).status).toBe(400);
    expect(row('rt_delivery_orders')).toBeUndefined();
    expect(row('rt_delivery_events')).toMatchObject({ status: 'failed', error_code: 'invalid_order_details' });
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await send()).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('取得中に統括が無効になれば保存しない', async () => {
    fetcher.mockImplementationOnce(async () => {
      database.raw.prepare(`UPDATE tenants SET status = 'suspended'`).run();
      return Response.json(details());
    });
    expect((await send()).status).toBe(503);
    expect(row('rt_delivery_orders')).toBeUndefined();
    expect(row('rt_delivery_events')).toMatchObject({ status: 'received' });
  });

  it.each(['orders.cancel', 'orders.failure'])('先着した%sを保持し、後続の新着通知で復活させない', async eventType => {
    expect((await send(notification('canceled-first', 'order-one', eventType))).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(row('rt_delivery_orders')).toBeUndefined();
    expect(database.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_events').get()).toEqual({ n: 2 });
  });

  it('既存注文の取消を反映し、別の新着通知で戻さない', async () => {
    await send();
    expect((await send(notification('cancellation', 'order-one', 'orders.cancel'))).status).toBe(200);
    expect((await send(notification('late-notification'))).status).toBe(200);
    expect(row('rt_delivery_orders')).toMatchObject({ status: 'canceled', canceled_by: 'service' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('取得済み詳細が取消済みなら新着として作らない', async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ ...details(), current_state: 'CANCELED' }));
    expect((await send()).status).toBe(200);
    expect(row('rt_delivery_orders')).toMatchObject({ status: 'canceled' });
  });

  it.each([['ACCEPTED', 'cooking'], ['DENIED', 'rejected'], ['FINISHED', 'handed_over']])('遅れて到着した%sを新着に戻さない', async (state, status) => {
    fetcher.mockImplementationOnce(async () => Response.json({ ...details(), current_state: state }));
    expect((await send()).status).toBe(200);
    expect(row('rt_delivery_orders')).toMatchObject({ status });
  });

  it('UNKNOWNは新着と仮定せず確認待ちにする', async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ ...details(), current_state: 'UNKNOWN' }));
    expect((await send()).status).toBe(400);
    expect(row('rt_delivery_orders')).toBeUndefined();
  });

  it('401は再送せず、受信した事実と固定の失敗理由を残す', async () => {
    fetcher.mockImplementationOnce(async () => new Response('private-provider-error', { status: 401 }));
    expect((await send()).status).toBe(400);
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await send()).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(row('rt_delivery_events')).toMatchObject({ status: 'failed', error_code: 'permanent_auth_expired' });
  });

  it('未対応通知は接続・保存・外部取得を必要とせず空の200を返す', async () => {
    database.raw.prepare('DELETE FROM rt_delivery_uber_connections').run();
    const response = await send(notification('event-other', 'order-one', 'unsupported.event'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
    expect(row('rt_delivery_events')).toBeUndefined();
  });
});
