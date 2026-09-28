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

const authMocks = vi.hoisted(() => ({
  getStaffByApiKey: vi.fn(async (): Promise<MockStaff | null> => null),
  getStaffByAdminSession: vi.fn(async (): Promise<MockStaff | null> => null),
  lineAccounts: [] as Array<Record<string, unknown>>,
}));

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

const { authMiddleware } = await import('../middleware/auth.js');
const { restaurantGooglePerformance } = await import('./restaurant-google-performance.js');
type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
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

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantGooglePerformance);
  return instance;
}

function call(path: string, token = 'owner-key') {
  return app().request(`${path}${path.includes('?') ? '&' : '?'}account_id=account-2`, { headers: { Authorization: `Bearer ${token}` } }, env);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
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
    testDb.raw
      .prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, can_access_descendant_accounts, is_active) VALUES ('staff-1', '担当', 'staff', 'staff-key', ?, 'all', 1, 1)`)
      .run(TENANT);
    authMocks.getStaffByApiKey.mockResolvedValue({ id: 'staff-1', name: '担当', role: 'staff', access_level: 'full', permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1 });
    const res = await call('/api/restaurant-test/google/performance?days=7', 'staff-key');
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
