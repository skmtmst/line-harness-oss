import { seedRestaurantFixture as seedRestaurantData } from '../test-utils/restaurant-fixture.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const authMocks = vi.hoisted(() => ({
  getPlatformSetting: async () => 'false', // Explicit Off fixture for route authorization.
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
const { restaurantTest } = await import('./restaurant-test.js');
type Env = import('../index.js').Env;

const here = dirname(fileURLToPath(import.meta.url));
let testDb: SqliteD1;
let env: Env['Bindings'];

const seedRestaurantFixture = (options?: Parameters<typeof seedRestaurantData>[1]) => seedRestaurantData(testDb, options);

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantTest);
  return instance;
}

function request(path: string, body?: unknown) {
  return requestAs(path, 'owner-key', body);
}

function requestAs(path: string, token: string, body?: unknown) {
  return app().request(path, body === undefined ? {
    headers: { Authorization: `Bearer ${token}` },
  } : {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function requestWithMethod(path: string, method: string, body?: unknown, token = 'owner-key') {
  if((method==='PUT'&&path.includes('/tables/layout')||method==='PATCH'&&path.includes('/tables/'))&&body&&typeof body==='object'&&!('expectedVersion' in body)){const table=path.match(/\/tables\/([^/?]+)/)?.[1];const floor=table?testDb.raw.prepare('SELECT f.version FROM rt_floors f JOIN rt_tables t ON t.floor_id=f.id WHERE t.id=?').get(table):testDb.raw.prepare("SELECT version FROM rt_floors WHERE store_id=?").get((body as {storeId:string}).storeId);body={...body,expectedVersion:(floor as {version:number}|undefined)?.version??1}}

  const id=path.match(/^\/api\/restaurant-test\/reservations\/([^/?]+)(?:\?|$)/)?.[1];
  if(method==='PATCH'&&id&&body&&typeof body==='object'&&!('expectedVersion' in body))body={...body,expectedVersion:((testDb.raw.prepare('SELECT customer_version FROM rt_reservations WHERE id=?').get(id)) as {customer_version:number}|undefined)?.customer_version??1};

  return app().request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.getStaffByAdminSession.mockReset();
  authMocks.getStaffByAdminSession.mockResolvedValue(null);
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '店舗A', is_active: 1, channel_access_token: 'token-2' },
    { id: 'account-3', name: '店舗B', is_active: 1, channel_access_token: 'token-3' },
    { id: 'account-4', name: '予備', is_active: 1, channel_access_token: 'token-4' },
  ];
  testDb = createTestD1({ loginPolicy: 'off' });
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/168_restaurant_test_foundation.sql'), 'utf8'));
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/175_restaurant_terms_agreement.sql'), 'utf8'));
  // 統括ゲート（飲食店機能パック）。このAPI群自体を検証するファイルなので
  // 既定の統括には常にパックを付けておく。ゲート自体の検証（無し→404）は
  // 別のdescribeで明示的に上書きする。
  testDb.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = '00000000-0000-4000-8000-000000000001'`).run();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    endpoint: 'https://worker.example.test/webhook',
    active: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    RESTAURANT_INTAKE_DOMAIN: 'intake.example.test',
    DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
});

describe('V8 仮押さえ・日付・来店履歴', () => {
  const hold = { storeId: 'store-ginza', startsAt: '2099-10-10T10:00:00Z', endsAt: '2099-10-10T12:00:00Z', guestCount: 2, holdMinutes: 15 };
  it('仮押さえは期限を保存し、重なる要求を409で止め、解除後は再登録できる', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_opening_hours_settings (store_id, hours_json, updated_by) VALUES ('store-ginza', '[]', 'test')").run();
    const res = await request('/api/restaurant-test/reservations/holds?account_id=account-1', hold);
    expect(res.status).toBe(201);
    const saved = (await res.json() as any).data;
    expect(Date.parse(saved.holdExpiresAt)).toBeGreaterThan(Date.now());
    expect((await request('/api/restaurant-test/reservations/holds?account_id=account-1', hold)).status).toBe(409);
    expect((await requestWithMethod(`/api/restaurant-test/reservations/${saved.id}?account_id=account-1`, 'PATCH', { status: 'cancelled' })).status).toBe(200);
    expect((await request('/api/restaurant-test/reservations/holds?account_id=account-1', hold)).status).toBe(201);
  });
  it('期限が切れた押さえを再読込で解除し、確定させない', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_opening_hours_settings (store_id, hours_json, updated_by) VALUES ('store-ginza', '[]', 'test')").run();
    const res = await request('/api/restaurant-test/reservations/holds?account_id=account-1', hold);
    const { id } = (await res.json() as any).data;
    testDb.raw.prepare("UPDATE rt_reservations SET hold_expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(id);
    expect((await requestWithMethod(`/api/restaurant-test/reservations/${id}?account_id=account-1`, 'PATCH', { status: 'confirmed' })).status).toBe(409);
    expect(testDb.raw.prepare('SELECT status FROM rt_reservations WHERE id=?').get(id)).toEqual({ status: 'cancelled' });
  });
  it('店の暦日で500件を超えても全予約を返し、別店舗を混ぜない', async () => {
    seedRestaurantFixture();
    const insert = testDb.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at) VALUES(?, 'store-ginza','phone','試験',1,'2099-10-09T15:00:00Z','2099-10-09T16:00:00Z')`);
    for (let i=0;i<501;i++) insert.run(`day-${i}`);
    const res = await request('/api/restaurant-test/reservations/day?account_id=account-1&storeId=store-ginza&date=2099-10-10');
    expect(res.status).toBe(200);
    expect((await res.json() as any).data.reservations).toHaveLength(501);
    expect((await request('/api/restaurant-test/reservations/day?account_id=account-1&storeId=store-ginza&date=2099-02-30')).status).toBe(400);
  });
  it('来店履歴はvisitedのみ、名前の一致で別人を混ぜない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("UPDATE rt_reservations SET customer_phone='090-0000-0000',status='visited' WHERE id='reservation-ginza'");
    let res = await request('/api/restaurant-test/customers/history?account_id=account-1&storeId=store-ginza&phone=09000000000');
    expect((await res.json() as any).data.visitCount).toBe(1);
    res = await request('/api/restaurant-test/customers/history?account_id=account-1&storeId=store-yokohama&phone=09000000000');
    expect((await res.json() as any).data.visitCount).toBe(0);
  });
  it('存在しない店舗・不正な期限では保存しない', async () => {
    seedRestaurantFixture();
    for (const body of [{ ...hold, holdMinutes: 0 }, { ...hold, storeId: 'other' }]) expect((await request('/api/restaurant-test/reservations/holds?account_id=account-1', body)).status).toBe(400);
  });
});
