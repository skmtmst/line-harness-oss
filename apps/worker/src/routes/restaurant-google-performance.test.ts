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
};

/*
 * Googleのルートは長期APIキーでは通さない（restaurant-google.ts の googleAccessGuard）。
 * Google Business Profile APIのポリシーが「End users of your Business Profile APIs need
 * to manually sign in to use it.」と定めているため、このファイルのテストも本番と同じ
 * 「管理画面に人がログインした状態」＝管理セッションで呼ぶ。
 *
 * 管理セッションは生のトークンではなくハッシュで引き当てるので、登録したトークンを
 * 順に照合して返す。
 */
const authMocks = vi.hoisted(() => {
  const sessions = new Map<string, unknown>();
  async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  id: 'owner-1', name: 'オーナー', role: 'owner', access_level: 'full',
  permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1,
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
const { restaurantGooglePerformance } = await import('./restaurant-google-performance.js');
const { encryptCredential } = await import('@line-crm/db');
type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
const LOCATION = 'accounts/111/locations/222';
const ENC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** 2026-09-28（月）12:00 JST。昨日 = 2026-09-27。 */
const NOW = new Date('2026-09-28T03:00:00.000Z');

let testDb: SqliteD1;
let env: Env['Bindings'];

function seedStore(): void {
  for (const [id, name] of [['account-1', '統括'], ['account-2', '渋谷店']]) {
    testDb.raw
      .prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run(id, `ch-${id}`, name, 'token', 'secret', TENANT);
  }
  testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)').run('org-1', 'account-1', TENANT, '飲食店LAB');
  testDb.raw
    .prepare('INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('store-shibuya', 'org-1', 'こもれび食堂 渋谷店', 'SHIBUYA', '東京', 20, 'account-2');
}

function seedMetrics(date: string, values: Partial<Record<string, number | null>>): void {
  testDb.raw
    .prepare(
      `INSERT INTO rt_google_metrics_daily
        (store_id, date, impressions_desktop_maps, impressions_desktop_search, impressions_mobile_maps, impressions_mobile_search,
         direction_requests, call_clicks, website_clicks, menu_clicks, bookings, food_orders)
       VALUES ('store-shibuya', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      date,
      values.impressions_desktop_maps ?? null,
      values.impressions_desktop_search ?? null,
      values.impressions_mobile_maps ?? null,
      values.impressions_mobile_search ?? null,
      values.direction_requests ?? null,
      values.call_clicks ?? null,
      values.website_clicks ?? null,
      values.menu_clicks ?? null,
      values.bookings ?? null,
      values.food_orders ?? null,
    );
}

async function seedConnection(): Promise<void> {
  testDb.raw
    .prepare(
      `INSERT INTO rt_google_connections
        (id, store_id, line_account_id, google_account_email, location_name, location_title, refresh_token_enc, access_token_enc, access_token_expires_at, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?)`,
    )
    .run('conn-1', 'store-shibuya', 'account-2', 'owner@example.test', LOCATION, 'こもれび食堂 渋谷店', await encryptCredential('refresh-secret', ENC_KEY), await encryptCredential('access-secret', ENC_KEY), '2099-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantGooglePerformance);
  return instance;
}

/** 管理セッションで呼ぶ。token は useStaffSession / OWNER_SESSION で登録したセッショントークン。 */
function call(path: string, token = 'owner-session', init: { method?: string } = {}) {
  return app().request(`${path}${path.includes('?') ? '&' : '?'}account_id=account-2`, { method: init.method, headers: { Authorization: `Bearer ${ADMIN_SESSION_BEARER_PREFIX}${token}` } }, env);
}

/** 担当者（staff）が管理画面にログインした状態を作る。 */
function useStaffSession(): void {
  testDb.raw
    .prepare(`INSERT OR REPLACE INTO staff_members (id, name, role, api_key, tenant_id, account_scope, can_access_descendant_accounts, is_active) VALUES ('staff-1', '担当', 'staff', 'staff-key', ?, 'all', 1, 1)`)
    .run(TENANT);
  authMocks.sessions.set('staff-session', { id: 'staff-1', name: '担当', role: 'staff', access_level: 'full', permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.sessions.clear();
  authMocks.sessions.set('owner-session', OWNER_SESSION);
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '渋谷店', is_active: 1, channel_access_token: 'token-2' },
  ];
  testDb = createTestD1();
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    RESTAURANT_TEST_ENABLED: 'true',
    WORKER_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENC_KEY,
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET: 'client-secret',
  } as Env['Bindings'];
  seedStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/restaurant-test/google/performance', () => {
  it('7・28・90日以外は400', async () => {
    const res = await call('/api/restaurant-test/google/performance?days=30');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('invalid_days');
  });

  it('期間の合計・前期比較・日別を自前DBから返す（Googleは呼ばない）', async () => {
    // 当期（9/21〜9/27）に2日ぶん、前期（9/14〜9/20）に1日ぶん。
    seedMetrics('2026-09-25', { impressions_mobile_search: 100, impressions_desktop_maps: 20, direction_requests: 5, call_clicks: 2, website_clicks: 8, menu_clicks: 7 });
    seedMetrics('2026-09-26', { impressions_mobile_search: 50, call_clicks: 1 });
    seedMetrics('2026-09-18', { impressions_mobile_search: 40, direction_requests: 3 });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await call('/api/restaurant-test/google/performance?days=7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(body.range).toEqual({ startDate: '2026-09-21', endDate: '2026-09-27' });
    expect(body.previousRange).toEqual({ startDate: '2026-09-14', endDate: '2026-09-20' });
    expect(body.totals).toEqual({ impressions: 170, directionRequests: 5, callClicks: 3, websiteClicks: 8 });
    expect(body.previousTotals.impressions).toBe(40);
    expect(body.previousTotals.directionRequests).toBe(3);
    // 前期に1件も値が無い指標は null（0と区別）
    expect(body.previousTotals.callClicks).toBeNull();
    expect(body.daily).toHaveLength(7);
    expect(body.daily[0]).toEqual({ date: '2026-09-21', impressions: null });
    expect(body.daily[4]).toEqual({ date: '2026-09-25', impressions: 120 });
    // 飲食店向け指標：menuClicks は値、bookings / foodOrders は未取得で null
    expect(body.food).toEqual({ menuClicks: 7, bookings: null, foodOrders: null });
  });

  it('データが1件も無いときは全指標nullで返す', async () => {
    const res = await call('/api/restaurant-test/google/performance?days=28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.totals).toEqual({ impressions: null, directionRequests: null, callClicks: null, websiteClicks: null });
    expect(body.daily).toHaveLength(28);
    expect(body.lastMetricsSyncedAt).toBeNull();
  });

  it('担当者（staff）も読み取れる', async () => {
    useStaffSession();
    const res = await call('/api/restaurant-test/google/performance?days=7', 'staff-session');
    expect(res.status).toBe(200);
  });

  it('応答に秘密値（トークン類）を含めない', async () => {
    const res = await call('/api/restaurant-test/google/performance?days=7');
    const text = await res.text();
    expect(text).not.toContain('token');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('_enc');
  });
});

describe('POST /api/restaurant-test/google/performance/sync（検証環境向け手動同期）', () => {
  function stubMetricsFetch(): ReturnType<typeof vi.fn> {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes('fetchMultiDailyMetricsTimeSeries')) {
        return new Response(
          JSON.stringify({
            multiDailyMetricTimeSeries: [
              { dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 25 }, value: '4' }] } }] },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  it('接続済み店舗のこの店舗だけをJST当日ゲート無視で取り直し、数値がGET側に反映される', async () => {
    await seedConnection();
    stubMetricsFetch();
    const res = await call('/api/restaurant-test/google/performance/sync', 'owner-session', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; synced: number; skipped: number; failed: number };
    expect(body).toMatchObject({ success: true, synced: 1, skipped: 0, failed: 0 });

    const row = testDb.raw.prepare('SELECT call_clicks FROM rt_google_metrics_daily WHERE store_id = ? AND date = ?').get('store-shibuya', '2026-09-25') as { call_clicks: number };
    expect(row.call_clicks).toBe(4);

    const get = await call('/api/restaurant-test/google/performance?days=7');
    const getBody = (await get.json()) as { totals: { callClicks: number | null } };
    expect(getBody.totals.callClicks).toBe(4);
  });

  it('接続が無い店舗は409', async () => {
    const res = await call('/api/restaurant-test/google/performance/sync', 'owner-session', { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('担当者（staff）も手動同期を実行できる', async () => {
    await seedConnection();
    stubMetricsFetch();
    useStaffSession();
    const res = await call('/api/restaurant-test/google/performance/sync', 'staff-session', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
