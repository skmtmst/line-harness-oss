/**
 * 飲食店向け（テスト）「デリバリー受注」のルートのテスト。
 * 設計正本：デリバリー受注_v02.pen の D-1 `kDQHr` / D-2 `hjdqV` / D-3 `dgeTy`
 *           / D-4 `OzHLO` / D-5 `h7OeT` / D-6 `XCVGd`（2026-10-09 承認）。
 *
 * ここで確かめるのは受入条件の2・3・4。
 * 2. 各サービスへの送信は送信台帳 rt_delivery_dispatches に記録し、成功時だけD1の
 *    状態を進める（失敗は分類済み符号のみ保存）
 * 3. 受信口は HMAC-SHA256 署名・5分の時刻ずれ制限・受信台帳の一意制約で守られ、
 *    重複通知を二重処理しない
 * 4. 取り消せない操作（注文キャンセル・受付一括停止）は確認手順(428)と
 *    owner/admin 権限で守られる
 *
 * SQL そのものが仕様（版での絞り込み・UNIQUE による重複吸収）なので、モックではなく
 * 本物の SQLite（createTestD1）に当てる。外部サービスへの通信だけを fetch で受ける。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

type MockStaff = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  access_level: 'full' | 'read_only';
  permission_keys: string;
  assigned_line_account_id: string | null;
  can_access_descendant_accounts: number;
  tenant_id?: string | null;
};

/* 管理セッションは生のトークンではなくハッシュで引き当てるので、登録した順に照合して返す。 */
const authMocks = vi.hoisted(() => {
  const sessions = new Map<string, unknown>();
  async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return {
    sessions,
    getStaffByApiKey: vi.fn(async (): Promise<unknown> => null),
    getStaffByAdminSession: vi.fn(async (_db: unknown, tokenHash: string): Promise<unknown> => {
      for (const [token, staff] of sessions) if ((await sha256Hex(token)) === tokenHash) return staff;
      return null;
    }),
    lineAccounts: [] as Array<Record<string, unknown>>,
  };
});

/** 管理画面にログインしたオーナー。既定のテスト利用者。 */
const OWNER_SESSION: MockStaff = {
  id: 'owner-1',
  name: 'オーナー',
  role: 'owner',
  access_level: 'full',
  permission_keys: '[]',
  assigned_line_account_id: null,
  can_access_descendant_accounts: 1,
};

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return {
    ...actual,
    getStaffByApiKey: authMocks.getStaffByApiKey,
    getStaffByAdminSession: authMocks.getStaffByAdminSession,
    getLineAccounts: vi.fn(async () => authMocks.lineAccounts),
    getLineAccountScopeEntries: vi.fn(async () => authMocks.lineAccounts),
  };
});

const { authMiddleware, ADMIN_SESSION_BEARER_PREFIX } = await import('../middleware/auth.js');
const { restaurantDelivery } = await import('./restaurant-delivery.js');
type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
const ENC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** 2026-10-09（金）12:00 JST。 */
const NOW = new Date('2026-10-09T03:00:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
/** 受信口の鍵は32文字以上でないと使われない（deliveryWebhookSecret）。 */
const UBEREATS_WEBHOOK_SECRET = 'ubereats-webhook-secret-0123456789ab';
const CANCEL_CONFIRM_TOKEN = 'delivery-order-cancel';
const INTAKE_STOP_CONFIRM_TOKEN = 'delivery-intake-stop';

/** サービスが返してくる自由文。台帳にも画面にも出てはいけない。 */
const PROVIDER_FREE_TEXT = 'merchant token expired for partner store 99812';

let testDb: SqliteD1;
let env: Env['Bindings'];
let deliveryCalls: Array<{ url: string; init?: RequestInit }>;
/** null 以外にすると、外部サービスへの送信がそのHTTP状態で落ちる。 */
let sendFailStatus: number | null;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function seedStore(): void {
  for (const [id, name] of [
    ['account-1', '統括'],
    ['account-2', '渋谷店'],
  ]) {
    testDb.raw
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, `ch-${id}`, name, 'token', 'secret', TENANT);
  }
  testDb.raw
    .prepare('INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)')
    .run('org-1', 'account-1', TENANT, '飲食店LAB');
  testDb.raw
    .prepare(
      `INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, status, line_account_id)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run('store-shibuya', 'org-1', 'こもれび食堂 渋谷店', 'SHIBUYA', '東京', 20, 'account-2');
}

/** D-1の表に出る注文を1件置く。状態と版を指定して、版での絞り込みも確かめられるようにする。 */
function seedOrder(
  overrides: {
    id?: string;
    status?: string;
    service?: string;
    externalOrderId?: string;
    version?: number;
  } = {},
): string {
  const id = overrides.id ?? 'order-1';
  testDb.raw
    .prepare(
      `INSERT INTO rt_delivery_orders
         (id, account_id, store_id, service, external_order_id, order_number, status,
          total_amount, currency, item_count, pickup_method, wanted_at, urgency,
          received_at, version, created_at, updated_at)
       VALUES (?, 'account-2', 'store-shibuya', ?, ?, ?, ?, 3200, 'JPY', 2,
               '配達（Uber Eats 配達員）', ?, 'normal', ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.service ?? 'ubereats',
      overrides.externalOrderId ?? `UE-${id}`,
      `#UE-${id}`,
      overrides.status ?? 'new',
      NOW_SEC + 1800,
      NOW_SEC - 60,
      overrides.version ?? 1,
      NOW_SEC - 60,
      NOW_SEC - 60,
    );
  return id;
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantDelivery);
  return instance;
}

/** 管理セッションで呼ぶ。token は useStaffRole / OWNER_SESSION で登録したセッショントークン。 */
function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string; confirm?: string } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ADMIN_SESSION_BEARER_PREFIX}${init.token ?? 'owner-session'}`,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.confirm !== undefined) headers['x-confirm-irreversible'] = init.confirm;
  return app().request(
    `${path}${path.includes('?') ? '&' : '?'}account_id=account-2`,
    {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
}

function useStaffRole(role: 'admin' | 'staff'): void {
  testDb.raw
    .prepare(
      `INSERT OR REPLACE INTO staff_members (id, name, role, api_key, tenant_id, account_scope, can_access_descendant_accounts, is_active)
       VALUES (?, ?, ?, ?, ?, 'all', 1, 1)`,
    )
    .run(`${role}-1`, role, role, `${role}-key`, TENANT);
  authMocks.sessions.set(`${role}-session`, {
    id: `${role}-1`,
    name: role,
    role,
    access_level: 'full',
    permission_keys: '[]',
    assigned_line_account_id: null,
    can_access_descendant_accounts: 1,
  });
}

/* ------------------------------ 受信口の署名 ------------------------------ */

/** 受信口が求める署名を本番と同じ材料（`${timestamp}.${rawBody}`）で作る。 */
async function signWebhook(timestamp: number, rawBody: string, secret = UBEREATS_WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function orderCreatedPayload(
  overrides: { eventId?: string; externalOrderId?: string; orderNumber?: string } = {},
) {
  return {
    event_id: overrides.eventId ?? 'evt-1',
    event_type: 'order.created',
    store_id: 'store-shibuya',
    order: {
      external_order_id: overrides.externalOrderId ?? 'UE-9001',
      order_number: overrides.orderNumber ?? '#UE-9001',
      total_amount: 2480,
      pickup_method: '配達（Uber Eats 配達員）',
      wanted_at: NOW_SEC + 1500,
      received_at: NOW_SEC - 30,
      items: [
        { name: '鶏の唐揚げ弁当', quantity: 2, amount: 1800 },
        { name: '味噌汁', note: '特製タレ増量（無料）', quantity: 1, amount: 680 },
      ],
    },
  };
}

/** 署名付きで受信口を叩く。既定は正しい署名・正しい時刻。 */
async function postWebhook(
  payload: unknown,
  init: {
    service?: string;
    timestamp?: number;
    signature?: string;
    secret?: string;
    rawBody?: string;
  } = {},
) {
  const rawBody = init.rawBody ?? JSON.stringify(payload);
  const timestamp = init.timestamp ?? NOW_SEC;
  const signature = init.signature ?? (await signWebhook(timestamp, rawBody, init.secret));
  return app().request(
    `/api/restaurant-test/delivery/webhooks/${init.service ?? 'ubereats'}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nen-timestamp': String(timestamp),
        'x-nen-signature': signature,
      },
      body: rawBody,
    },
    env,
  );
}

/* ------------------------------ 台帳の読み出し ------------------------------ */

function dispatchRows(): Array<Record<string, unknown>> {
  return testDb.raw
    .prepare('SELECT * FROM rt_delivery_dispatches ORDER BY created_at, id')
    .all() as Array<Record<string, unknown>>;
}

function eventRows(): Array<Record<string, unknown>> {
  return testDb.raw.prepare('SELECT * FROM rt_delivery_events ORDER BY received_at, id').all() as Array<
    Record<string, unknown>
  >;
}

function orderRow(id = 'order-1'): Record<string, unknown> | undefined {
  return testDb.raw.prepare('SELECT * FROM rt_delivery_orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.sessions.clear();
  authMocks.sessions.set('owner-session', OWNER_SESSION);
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '渋谷店', is_active: 1, channel_access_token: 'token-2' },
  ];
  testDb = createTestD1();
  testDb.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`).run(TENANT);

  deliveryCalls = [];
  sendFailStatus = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      deliveryCalls.push({ url, init });
      if (sendFailStatus !== null) {
        // サービスは自由文つきで落ちてくる。この本文はどこにも残ってはいけない。
        return new Response(JSON.stringify({ message: PROVIDER_FREE_TEXT }), {
          status: sendFailStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as unknown as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    AI: { run: vi.fn(async () => ({ response: '' })) } as unknown as Ai,
    RESTAURANT_TEST_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'unused',
    LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test',
    LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    ADMIN_PUBLIC_URL: 'https://admin.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENC_KEY,
    RT_DELIVERY_SEND_ENABLED: 'true',
    RT_DELIVERY_UBEREATS_API_BASE_URL: 'https://ubereats.example.test',
    RT_DELIVERY_UBEREATS_API_TOKEN: 'ubereats-token',
    RT_DELIVERY_UBEREATS_WEBHOOK_SECRET: UBEREATS_WEBHOOK_SECRET,
  } as unknown as Env['Bindings'];
  seedStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

/* ============================== 受入条件2 ============================== */

describe('送信台帳（受入条件2）', () => {
  it('送信が成功したときだけD1の状態を進め、台帳に成功として残す', async () => {
    seedOrder({ status: 'new' });

    const response = await call('/api/restaurant-test/delivery/orders/order-1/accept', { body: {} });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      order: { id: 'order-1', status: 'cooking' },
    });

    // 外へ出たのは1回だけ。宛先は各サービスの店舗向け窓口（受注一元化サービスは経由しない）。
    expect(deliveryCalls).toHaveLength(1);
    expect(deliveryCalls[0]?.url).toBe('https://ubereats.example.test/orders/accept');

    const rows = dispatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      service: 'ubereats',
      action: 'accept',
      target_kind: 'order',
      target_id: 'order-1',
      status: 'succeeded',
      error_code: null,
    });
    expect(rows[0]?.completed_at).toBe(NOW_SEC);

    const order = orderRow();
    expect(order?.status).toBe('cooking');
    expect(order?.accepted_at).toBe(NOW_SEC);
    expect(order?.version).toBe(2);
  });

  it('送信が一時的に失敗したら状態は進めず、台帳には分類済み符号だけを残す', async () => {
    seedOrder({ status: 'new' });
    sendFailStatus = 500;

    const response = await call('/api/restaurant-test/delivery/orders/order-1/accept', { body: {} });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'delivery_temporary_failure',
      retryable: true,
    });

    const rows = dispatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'retryable_failed', error_code: 'delivery_temporary_failure' });
    // サービスから返った自由文は台帳のどこにも入れない。
    expect(JSON.stringify(rows[0])).not.toContain(PROVIDER_FREE_TEXT);

    // D1の状態は動かさない。再送は台帳の next_attempt_at から行う。
    const order = orderRow();
    expect(order?.status).toBe('new');
    expect(order?.accepted_at).toBeNull();
    expect(order?.version).toBe(1);
    expect(rows[0]?.next_attempt_at).not.toBeNull();
  });

  it('認証が通らない失敗は再試行しない符号で残し、502を返す', async () => {
    seedOrder({ status: 'cooking' });
    sendFailStatus = 401;

    const response = await call('/api/restaurant-test/delivery/orders/order-1/ready', { body: {} });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'delivery_authentication_failed',
      retryable: false,
    });

    const rows = dispatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'ready',
      status: 'failed',
      error_code: 'delivery_authentication_failed',
    });
    expect(orderRow()?.status).toBe('cooking');
    expect(orderRow()?.ready_at).toBeNull();
  });

  it('送信が止められている設定でも台帳には記録し、状態は進めない', async () => {
    seedOrder({ status: 'new' });
    env = { ...env, RT_DELIVERY_SEND_ENABLED: 'false' } as Env['Bindings'];

    const response = await call('/api/restaurant-test/delivery/orders/order-1/accept', { body: {} });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'delivery_send_disabled' });

    // 外へは一歩も出ない。
    expect(deliveryCalls).toHaveLength(0);
    const rows = dispatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', error_code: 'delivery_send_disabled' });
    expect(orderRow()?.status).toBe('new');
  });

  it('進められない状態の注文は送信もせず409で返す', async () => {
    seedOrder({ status: 'handed_over' });

    const response = await call('/api/restaurant-test/delivery/orders/order-1/accept', { body: {} });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_STATUS', status: 'handed_over' });
    expect(deliveryCalls).toHaveLength(0);
    expect(dispatchRows()).toHaveLength(0);
  });
});

/* ============================== 受入条件3 ============================== */

describe('受信口（受入条件3）', () => {
  it('署名が正しい通知を取り込み、受信台帳へ残す', async () => {
    const response = await postWebhook(orderCreatedPayload());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, result: 'created' });

    const events = eventRows();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      service: 'ubereats',
      external_event_id: 'evt-1',
      event_type: 'order.created',
      external_order_id: 'UE-9001',
      status: 'processed',
      error_code: null,
    });

    const orders = testDb.raw
      .prepare('SELECT * FROM rt_delivery_orders WHERE external_order_id = ?')
      .all('UE-9001') as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ store_id: 'store-shibuya', status: 'new', item_count: 3 });
    const items = testDb.raw
      .prepare('SELECT name, quantity FROM rt_delivery_order_items WHERE order_id = ? ORDER BY position')
      .all(orders[0]?.id) as Array<Record<string, unknown>>;
    expect(items.map((item) => item.name)).toEqual(['鶏の唐揚げ弁当', '味噌汁']);
  });

  it('署名が違う通知は401で断り、何も取り込まない', async () => {
    const response = await postWebhook(orderCreatedPayload(), { signature: 'f'.repeat(64) });
    expect(response.status).toBe(401);
    expect(eventRows()).toHaveLength(0);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_orders').get()).toMatchObject({ n: 0 });
  });

  it('本文を書き換えた通知は署名が合わず401になる', async () => {
    const payload = orderCreatedPayload();
    const signed = JSON.stringify(payload);
    const tampered = JSON.stringify({ ...payload, order: { ...payload.order, total_amount: 1 } });
    const signature = await signWebhook(NOW_SEC, signed);

    const response = await postWebhook(null, { rawBody: tampered, signature });
    expect(response.status).toBe(401);
    expect(eventRows()).toHaveLength(0);
  });

  it('5分より古い通知は401で断る', async () => {
    const response = await postWebhook(orderCreatedPayload(), { timestamp: NOW_SEC - 301 });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Expired request' });
    expect(eventRows()).toHaveLength(0);
  });

  it('5分より先の時刻の通知も401で断る', async () => {
    const response = await postWebhook(orderCreatedPayload(), { timestamp: NOW_SEC + 301 });
    expect(response.status).toBe(401);
    expect(eventRows()).toHaveLength(0);
  });

  it('5分以内のずれは受け付ける', async () => {
    const response = await postWebhook(orderCreatedPayload(), { timestamp: NOW_SEC - 299 });
    expect(response.status).toBe(200);
    expect(eventRows()).toHaveLength(1);
  });

  it('同じ通知が二度届いても二重処理しない', async () => {
    const payload = orderCreatedPayload();
    const first = await postWebhook(payload);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ success: true, result: 'created' });

    const second = await postWebhook(payload);
    expect(second.status).toBe(200);
    // 再送でも同じ200を返して相手の再試行を止める。
    await expect(second.json()).resolves.toEqual({ success: true, duplicate: true });

    expect(eventRows()).toHaveLength(1);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_orders').get()).toMatchObject({ n: 1 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_order_items').get()).toMatchObject({ n: 2 });
  });

  it('通知IDが違えば別の注文として取り込む', async () => {
    await postWebhook(orderCreatedPayload());
    const response = await postWebhook(
      orderCreatedPayload({ eventId: 'evt-2', externalOrderId: 'UE-9002', orderNumber: '#UE-9002' }),
    );
    expect(response.status).toBe(200);
    expect(eventRows()).toHaveLength(2);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_orders').get()).toMatchObject({ n: 2 });
  });

  it('同じ注文IDの別通知は注文を増やさず duplicate として返す', async () => {
    await postWebhook(orderCreatedPayload());
    const response = await postWebhook(orderCreatedPayload({ eventId: 'evt-3' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, result: 'duplicate' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_orders').get()).toMatchObject({ n: 1 });
  });

  it('知らないサービスの受信口は404', async () => {
    const response = await postWebhook(orderCreatedPayload(), { service: 'menu' });
    expect(response.status).toBe(404);
    expect(eventRows()).toHaveLength(0);
  });

  it('鍵が設定されていないサービスは503で断り、署名の判定へ進まない', async () => {
    env = { ...env, RT_DELIVERY_UBEREATS_WEBHOOK_SECRET: undefined } as Env['Bindings'];
    const response = await postWebhook(orderCreatedPayload());
    expect(response.status).toBe(503);
    expect(eventRows()).toHaveLength(0);
  });

  it('お客様からのキャンセル通知で注文を終わらせる', async () => {
    seedOrder({ status: 'cooking', externalOrderId: 'UE-7001' });
    const response = await postWebhook({
      event_id: 'evt-cancel-1',
      event_type: 'order.canceled',
      store_id: 'store-shibuya',
      cancel: { external_order_id: 'UE-7001', canceled_by: 'customer' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, result: 'canceled' });

    const order = orderRow();
    expect(order?.status).toBe('canceled');
    expect(order?.canceled_by).toBe('customer');
    expect(order?.cancel_reason_code).toBe('customer_request');
    // 外へ送り返す操作ではないので送信台帳は使わない。
    expect(dispatchRows()).toHaveLength(0);
  });
});

/* ============================== 受入条件4 ============================== */

describe('取り消せない操作（受入条件4）', () => {
  it('注文キャンセルは確認手順がないと428で止まる', async () => {
    seedOrder({ status: 'cooking' });

    const response = await call('/api/restaurant-test/delivery/orders/order-1/cancel', {
      body: { reason_code: 'out_of_stock' },
    });
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(deliveryCalls).toHaveLength(0);
    expect(dispatchRows()).toHaveLength(0);
    expect(orderRow()?.status).toBe('cooking');
  });

  it('確認のしるしが違っても428で止まる', async () => {
    seedOrder({ status: 'cooking' });
    const response = await call('/api/restaurant-test/delivery/orders/order-1/cancel', {
      body: { reason_code: 'out_of_stock' },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(428);
    expect(orderRow()?.status).toBe('cooking');
  });

  it('確認手順を経た注文キャンセルは理由を残して通る', async () => {
    seedOrder({ status: 'cooking' });
    const response = await call('/api/restaurant-test/delivery/orders/order-1/cancel', {
      body: { reason_code: 'out_of_stock' },
      confirm: CANCEL_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ order: { status: 'canceled' } });

    const order = orderRow();
    expect(order?.cancel_reason_code).toBe('out_of_stock');
    expect(order?.canceled_by).toBe('store');
    expect(order?.canceled_at).toBe(NOW_SEC);
    expect(dispatchRows()[0]).toMatchObject({ action: 'cancel', status: 'succeeded' });
  });

  it('理由を選んでいないキャンセルは400で返す', async () => {
    seedOrder({ status: 'cooking' });
    const response = await call('/api/restaurant-test/delivery/orders/order-1/cancel', {
      body: {},
      confirm: CANCEL_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'REASON_REQUIRED' });
    expect(orderRow()?.status).toBe('cooking');
  });

  it('担当者（staff）は注文キャンセルできない', async () => {
    seedOrder({ status: 'cooking' });
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/orders/order-1/cancel', {
      body: { reason_code: 'out_of_stock' },
      confirm: CANCEL_CONFIRM_TOKEN,
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(orderRow()?.status).toBe('cooking');
  });

  it('受付一括停止は確認手順がないと428で止まる', async () => {
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '30m' },
    });
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(deliveryCalls).toHaveLength(0);
    expect(dispatchRows()).toHaveLength(0);
  });

  it('担当者（staff）は受付一括停止できない', async () => {
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '30m' },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(dispatchRows()).toHaveLength(0);
  });

  it('確認手順を経た受付一括停止は送れたサービスだけ停止にする', async () => {
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '30m', services: ['ubereats'] },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      preset: '30m',
      stopped: ['ubereats'],
      failed: [],
    });

    expect(dispatchRows()[0]).toMatchObject({
      action: 'intake_stop',
      target_kind: 'service',
      target_id: 'ubereats',
      status: 'succeeded',
    });
    const state = testDb.raw
      .prepare('SELECT * FROM rt_delivery_service_states WHERE store_id = ? AND service = ?')
      .get('store-shibuya', 'ubereats') as Record<string, unknown> | undefined;
    expect(state).toMatchObject({ intake_status: 'stopped' });
    expect(state?.stop_until).toBe(NOW_SEC + 30 * 60);
  });

  it('停止する長さを選んでいないときは400で返す', async () => {
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { services: ['ubereats'] },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(400);
    expect(dispatchRows()).toHaveLength(0);
  });

  it('送信が全部失敗したら受付状態は変えない', async () => {
    sendFailStatus = 429;
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '60m', services: ['ubereats'] },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'delivery_rate_limited', retryable: true });

    expect(dispatchRows()[0]).toMatchObject({ status: 'retryable_failed', error_code: 'delivery_rate_limited' });
    expect(
      testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_service_states').get(),
    ).toMatchObject({ n: 0 });
  });

  it('受付の再開は確認手順を求めない（元に戻す操作なので）', async () => {
    const stopped = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '30m', services: ['ubereats'] },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(stopped.status).toBe(200);

    const response = await call('/api/restaurant-test/delivery/intake/resume', {
      body: { services: ['ubereats'] },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, resumed: ['ubereats'] });
    const state = testDb.raw
      .prepare('SELECT * FROM rt_delivery_service_states WHERE store_id = ? AND service = ?')
      .get('store-shibuya', 'ubereats') as Record<string, unknown> | undefined;
    expect(state).toMatchObject({ intake_status: 'open', stop_until: null });
  });

  it('担当者（staff）は受付の再開もできない', async () => {
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/intake/resume', {
      body: { services: ['ubereats'] },
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
  });
});

describe('書き込みは店舗管理者以上だけ（受入条件1）', () => {
  it('担当者（staff）は注文を受け付けられない', async () => {
    seedOrder();
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/orders/order-1/accept', {
      body: {},
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(orderRow()?.status).toBe('new');
    expect(deliveryCalls).toHaveLength(0);
    expect(dispatchRows()).toHaveLength(0);
  });

  it('担当者（staff）は準備完了にできない', async () => {
    seedOrder({ status: 'cooking' });
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/orders/order-1/ready', {
      body: {},
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(orderRow()?.status).toBe('cooking');
    expect(deliveryCalls).toHaveLength(0);
  });

  it('担当者（staff）は受け渡し済みにできない', async () => {
    seedOrder({ status: 'cooking' });
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/orders/order-1/handed-over', {
      body: {},
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(orderRow()?.status).toBe('cooking');
    expect(deliveryCalls).toHaveLength(0);
  });

  it('担当者（staff）は注文を拒否できない', async () => {
    seedOrder();
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/orders/order-1/reject', {
      body: { reason_code: 'out_of_stock' },
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(orderRow()?.status).toBe('new');
  });

  it('担当者（staff）は品切れをまとめて切り替えられない', async () => {
    useStaffRole('staff');
    const response = await call('/api/restaurant-test/delivery/menu-items/bulk-sold-out', {
      body: { item_ids: ['item-1'], sold_out: true },
      token: 'staff-session',
    });
    expect(response.status).toBe(403);
    expect(deliveryCalls).toHaveLength(0);
    expect(dispatchRows()).toHaveLength(0);
  });

  it('見るだけの一覧・履歴・CSV・商品一覧は担当者（staff）でも使える', async () => {
    seedOrder();
    useStaffRole('staff');
    for (const path of [
      '/api/restaurant-test/delivery/orders',
      '/api/restaurant-test/delivery/orders/order-1',
      '/api/restaurant-test/delivery/history',
      '/api/restaurant-test/delivery/history.csv',
      '/api/restaurant-test/delivery/menu-items',
    ]) {
      const response = await call(path, { token: 'staff-session' });
      expect(response.status, path).toBe(200);
    }
  });
});

describe('期限が過ぎた受付停止の自動再開（受入条件2）', () => {
  /** 30分の停止をかける。D-6の窓から送られる形と同じ。 */
  async function stopFor30m() {
    const response = await call('/api/restaurant-test/delivery/intake/stop', {
      body: { preset: '30m', services: ['ubereats'] },
      confirm: INTAKE_STOP_CONFIRM_TOKEN,
    });
    expect(response.status).toBe(200);
    deliveryCalls = [];
    return response;
  }

  function stateRow(service = 'ubereats'): Record<string, unknown> | undefined {
    return testDb.raw
      .prepare('SELECT * FROM rt_delivery_service_states WHERE store_id = ? AND service = ?')
      .get('store-shibuya', service) as Record<string, unknown> | undefined;
  }

  async function servicesFromOrders(): Promise<
    Array<{ service: string; intakeStatus: string; stopUntil: string | null }>
  > {
    const response = await call('/api/restaurant-test/delivery/orders');
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      services: Array<{ service: string; intakeStatus: string; stopUntil: string | null }>;
    };
    return data.services;
  }

  it('期限が過ぎたら一覧を読んだ時点で受付中へ戻り、再開も送られる', async () => {
    await stopFor30m();
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));

    const services = await servicesFromOrders();
    expect(services.find((state) => state.service === 'ubereats')).toMatchObject({
      intakeStatus: 'open',
      stopUntil: null,
    });
    expect(deliveryCalls.some((request) => request.url.endsWith('/intake/resume'))).toBe(true);
    expect(stateRow()).toMatchObject({ intake_status: 'open', stop_until: null });
    expect(dispatchRows().at(-1)).toMatchObject({
      action: 'intake_resume',
      target_kind: 'service',
      target_id: 'ubereats',
      status: 'succeeded',
    });
  });

  it('期限内はそのまま停止で残り、再開は送らない', async () => {
    await stopFor30m();
    vi.setSystemTime(new Date(NOW.getTime() + 29 * 60 * 1000));

    const services = await servicesFromOrders();
    expect(services.find((state) => state.service === 'ubereats')?.intakeStatus).toBe('stopped');
    expect(deliveryCalls).toHaveLength(0);
    expect(stateRow()).toMatchObject({ intake_status: 'stopped' });
  });

  it('再開を送れなかったサービスは停止のまま残り、次に読んだ時にもう一度試す', async () => {
    await stopFor30m();
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));

    sendFailStatus = 429;
    const failed = await servicesFromOrders();
    expect(failed.find((state) => state.service === 'ubereats')?.intakeStatus).toBe('stopped');
    expect(stateRow()).toMatchObject({ intake_status: 'stopped' });
    expect(dispatchRows().at(-1)).toMatchObject({ action: 'intake_resume', status: 'retryable_failed' });

    sendFailStatus = null;
    const retried = await servicesFromOrders();
    expect(retried.find((state) => state.service === 'ubereats')?.intakeStatus).toBe('open');
    expect(stateRow()).toMatchObject({ intake_status: 'open', stop_until: null });
  });

  it('手で再開した後は自動再開を重ねて送らない', async () => {
    await stopFor30m();
    const resumed = await call('/api/restaurant-test/delivery/intake/resume', {
      body: { services: ['ubereats'] },
    });
    expect(resumed.status).toBe(200);
    deliveryCalls = [];

    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
    const services = await servicesFromOrders();
    expect(services.find((state) => state.service === 'ubereats')?.intakeStatus).toBe('open');
    expect(deliveryCalls).toHaveLength(0);
  });
});
