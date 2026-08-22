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
};

const authMocks = vi.hoisted(() => ({
  getStaffByApiKey: vi.fn(async (): Promise<MockStaff | null> => null),
}));

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: authMocks.getStaffByApiKey,
  getLineAccounts: vi.fn(async () => [{ id: 'account-1' }]),
}));

const { authMiddleware } = await import('../middleware/auth.js');
const { restaurantTest } = await import('./restaurant-test.js');
type Env = import('../index.js').Env;

const here = dirname(fileURLToPath(import.meta.url));
let testDb: SqliteD1;
let env: Env['Bindings'];

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

beforeEach(() => {
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  testDb = createTestD1();
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/168_restaurant_test_foundation.sql'), 'utf8'));
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    RESTAURANT_INTAKE_DOMAIN: 'intake.example.test',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
  };
});

describe('飲食店向けテストAPI', () => {
  it('既存領域と分離したテストデータを準備してR-1〜R-8の読取モデルを返す', async () => {
    const bootstrap = await request('/api/restaurant-test/bootstrap?account_id=account-1', { organizationName: '飲食店LAB' });
    expect(bootstrap.status).toBe(201);

    const snapshot = await request('/api/restaurant-test/snapshot?account_id=account-1');
    expect(snapshot.status).toBe(200);
    const json = await snapshot.json() as { data: Record<string, unknown[]> & { integrationPolicy: string; organization: { name: string } } };
    expect(json.data.organization.name).toBe('飲食店LAB');
    expect(json.data.integrationPolicy).toBe('inbound_only');
    expect(json.data.stores.length).toBe(2);
    expect(json.data.reservations.length).toBeGreaterThan(0);
    expect(json.data.tables.length).toBeGreaterThan(0);
    expect(json.data.menuItems.length).toBeGreaterThan(0);
    expect(json.data.lineFlows.length).toBe(6);
  });

  it('媒体予約を一方向で冪等取込し、外部書戻しを0件のままにする', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare('SELECT id FROM rt_stores ORDER BY code LIMIT 1').get() as { id: string };
    const payload = {
      storeId: store.id,
      provider: 'restaurant_board',
      eventId: 'event-100',
      reservation: {
        externalId: 'RB-9000', customerName: '検証 太郎', guestCount: 3,
        startsAt: '2026-08-22T09:00:00.000Z', endsAt: '2026-08-22T11:00:00.000Z',
      },
    };
    const first = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', payload);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { direction: 'inbound', outboundWrites: 0, duplicate: false } });

    const duplicate = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', payload);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ data: { direction: 'inbound', duplicate: true } });
    const count = testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_reservations WHERE external_id = 'RB-9000'").get() as { count: number };
    expect(count.count).toBe(1);
    const direction = testDb.raw.prepare("SELECT sync_direction FROM rt_reservations WHERE external_id = 'RB-9000'").get() as { sync_direction: string };
    expect(direction.sync_direction).toBe('inbound_only');
  });

  it('双方向を示す未知の媒体値を拒否する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };
    const response = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'outbound', eventId: 'event-x', reservation: {},
    });
    expect(response.status).toBe(400);
  });

  it('取り込みアドレスはオーナーだけが発行でき、スタッフは拒否する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };

    const issued = await request('/api/restaurant-test/intake-addresses?account_id=account-1', { storeId: store.id });
    expect(issued.status).toBe(201);
    expect(await issued.json()).toMatchObject({
      data: { address: expect.stringMatching(/^r-[a-z0-9]{32}@intake\.example\.test$/) },
    });

    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'staff-1',
      name: 'Staff',
      role: 'staff',
      access_level: 'full',
      permission_keys: '[]',
      assigned_line_account_id: null,
      can_access_descendant_accounts: 0,
    });
    const denied = await requestAs(
      '/api/restaurant-test/intake-addresses?account_id=account-1',
      'staff-key',
      { storeId: store.id },
    );
    expect(denied.status).toBe(403);
  });

  it('この組織に存在しないLINEアカウントの飲食店データへアクセスさせない', async () => {
    const response = await request('/api/restaurant-test/snapshot?account_id=account-2');
    expect(response.status).toBe(403);
  });
});
