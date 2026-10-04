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

function seedStore() {
  testDb.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`)
    .run('00000000-0000-4000-8000-000000000001');
  testDb.raw.prepare(
    'INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)',
  ).run('org-1', 'account-1', '00000000-0000-4000-8000-000000000001', '検証組織');
  testDb.raw.prepare(
    'INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('store-1', 'org-1', '渋谷店', 'SHIBUYA', '東京', 32, 'account-1');
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantTest);
  return instance;
}

function get(path: string) {
  return app().request(path, { headers: { Authorization: 'Bearer owner-key' } }, env);
}

function put(path: string, body: unknown) {
  return app().request(path, {
    method: 'PUT',
    headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.getStaffByAdminSession.mockReset();
  authMocks.getStaffByAdminSession.mockResolvedValue(null);
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
  ];
  testDb = createTestD1();
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/168_restaurant_test_foundation.sql'), 'utf8'));
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/556_store_auto_rules.sql'), 'utf8'));
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    RESTAURANT_TEST_ENABLED: 'true',
  } as Env['Bindings'];
  seedStore();
});

const FULL_RULES = {
  autoAssignSeats: false,
  countRemaining: false,
  mergeDuplicates: true,
  lowSeatThreshold: 2,
  lineAction: 'reduce',
  walkinAction: 'reduce',
  closeBanner: false,
  notifyLine: false,
  duplicateNotify: true,
};

describe('F-24 店ごとの自動で合わせるルール', () => {
  it('無ければ既定を返す', async () => {
    const res = await get('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: {
        autoAssignSeats: true,
        countRemaining: true,
        mergeDuplicates: true,
        lowSeatThreshold: 4,
        lineAction: 'stop',
        walkinAction: 'stop',
        closeBanner: true,
        notifyLine: true,
        duplicateNotify: true,
      },
    });
  });

  it('保存して読み直せる', async () => {
    const putRes = await put('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1', FULL_RULES);
    expect(putRes.status).toBe(200);
    await expect(putRes.json()).resolves.toEqual({ success: true, data: FULL_RULES });
    const getRes = await get('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1');
    await expect(getRes.json()).resolves.toEqual({ success: true, data: FULL_RULES });
  });

  it('真偽値でない項目・範囲外の数は400', async () => {
    expect((await put('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1', { ...FULL_RULES, closeBanner: 'yes' })).status).toBe(400);
    expect((await put('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1', { ...FULL_RULES, lowSeatThreshold: 101 })).status).toBe(400);
    expect((await put('/api/restaurant-test/stores/store-1/auto-rules?account_id=account-1', { ...FULL_RULES, lineAction: 'keep' })).status).toBe(400);
  });

  it('別の店の店舗IDでは400', async () => {
    const res = await get('/api/restaurant-test/stores/store-other/auto-rules?account_id=account-1');
    expect(res.status).toBe(400);
  });
});
