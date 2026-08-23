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
  };
});

const { authMiddleware, sha256Hex } = await import('../middleware/auth.js');
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

function requestWithMethod(path: string, method: string, body?: unknown, token = 'owner-key') {
  return app().request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
}

async function createAdminSession(token = 'restaurant-session'): Promise<string> {
  authMocks.getStaffByAdminSession.mockResolvedValue({
    id: 'owner-session', name: 'Owner', role: 'owner', access_level: 'full',
    permission_keys: '[]', assigned_line_account_id: null,
    can_access_descendant_accounts: 1,
  });
  testDb.raw.prepare(
    'INSERT INTO admin_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
  ).run(await sha256Hex(token), 'owner-session', '2099-01-01T00:00:00.000Z');
  return `${ADMIN_SESSION_PREFIX}${token}`;
}

const ADMIN_SESSION_PREFIX = 'lh_session:';

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
  testDb = createTestD1();
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/168_restaurant_test_foundation.sql'), 'utf8'));
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/175_restaurant_terms_agreement.sql'), 'utf8'));
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
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
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
    expect(JSON.stringify(json)).not.toContain('token-');
  });

  it('従来のaccount_idと新しいtenant_idが同じ組織を返す', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {
      organizationName: '二重解決LAB',
    });
    const byAccount = await request('/api/restaurant-test/snapshot?account_id=account-1');
    const byTenant = await request(
      '/api/restaurant-test/snapshot?tenant_id=00000000-0000-4000-8000-000000000001',
    );
    expect(byAccount.status).toBe(200);
    expect(byTenant.status).toBe(200);
    const accountJson = await byAccount.json() as { data: { organization: unknown; stores: unknown[] } };
    const tenantJson = await byTenant.json() as { data: { organization: unknown; stores: unknown[] } };
    expect(tenantJson.data.organization).toEqual(accountJson.data.organization);
    expect(tenantJson.data.stores).toEqual(accountJson.data.stores);
  });

  it('tenant_idから作る統括はレガシーaccount_idにも同じ値を入れる', async () => {
    const tenant = '00000000-0000-4000-8000-000000000001';
    const bootstrap = await request(`/api/restaurant-test/bootstrap?tenant_id=${tenant}`, {
      organizationName: 'LINE非依存の統括',
    });
    expect(bootstrap.status).toBe(201);
    expect(testDb.raw.prepare(`SELECT account_id, tenant_id
      FROM rt_organizations`).get()).toEqual({ account_id: tenant, tenant_id: tenant });
  });

  it('認証スタッフと異なるtenant_idは403にする', async () => {
    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'admin-tenant', name: 'Admin', role: 'admin', access_level: 'full',
      permission_keys: '[]', assigned_line_account_id: null,
      can_access_descendant_accounts: 0,
      tenant_id: '00000000-0000-4000-8000-000000000001',
    });
    const response = await requestAs(
      '/api/restaurant-test/snapshot?tenant_id=00000000-0000-4000-8000-000000000099',
      'admin-key',
    );
    expect(response.status).toBe(403);
  });

  it('店舗未選択の管理画面セッションでは統括組織の全店舗を返す', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const session = await createAdminSession();

    const snapshot = await requestAs('/api/restaurant-test/snapshot?account_id=account-1', session);
    expect(snapshot.status).toBe(200);
    const json = await snapshot.json() as { data: { stores: unknown[] } };
    expect(json.data.stores).toHaveLength(2);
  });

  it('利用規約への同意を組織・現行版ごとに冪等記録する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const body = { documentKey: 'musubo-terms', version: 'v0.1-draft' };
    const first = await request('/api/restaurant-test/terms-agreement?account_id=account-1', body);
    const second = await request('/api/restaurant-test/terms-agreement?account_id=account-1', body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      data: { documentKey: 'musubo-terms', agreedVersion: 'v0.1-draft' },
    });
    const count = testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organization_agreements').get() as { count: number };
    expect(count.count).toBe(1);
    const row = testDb.raw.prepare(`SELECT agreed_by_staff_id, document_key, document_version
      FROM rt_organization_agreements`).get() as Record<string, unknown>;
    expect(row).toEqual({
      agreed_by_staff_id: 'env-owner',
      document_key: 'musubo-terms',
      document_version: 'v0.1-draft',
    });
  });

  it('現行版以外の規約同意を拒否し、組織が無ければGET・POSTとも404にする', async () => {
    const missingGet = await request('/api/restaurant-test/terms-agreement?account_id=account-1');
    const missingPost = await request('/api/restaurant-test/terms-agreement?account_id=account-1', {
      documentKey: 'musubo-terms', version: 'v0.1-draft',
    });
    expect(missingGet.status).toBe(404);
    expect(missingPost.status).toBe(404);

    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const oldVersion = await request('/api/restaurant-test/terms-agreement?account_id=account-1', {
      documentKey: 'musubo-terms', version: 'v0.0-draft',
    });
    expect(oldVersion.status).toBe(400);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organization_agreements').get())
      .toMatchObject({ count: 0 });
  });

  it('staffは規約状態を読めるが同意記録は作れない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'staff-terms', name: 'Staff', role: 'staff', access_level: 'full',
      permission_keys: '[]', assigned_line_account_id: null,
      can_access_descendant_accounts: 0,
    });
    const state = await requestAs(
      '/api/restaurant-test/terms-agreement?account_id=account-1',
      'staff-key',
    );
    const denied = await requestAs(
      '/api/restaurant-test/terms-agreement?account_id=account-1',
      'staff-key',
      { documentKey: 'musubo-terms', version: 'v0.1-draft' },
    );
    expect(state.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('同一組織の店舗だけをセッションへ保存し、統括へ戻すと選択を消す', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, name) VALUES (?, ?, ?)')
      .run('org-other', 'account-other', '別組織');
    testDb.raw.prepare('INSERT INTO rt_stores (id, organization_id, name, code, capacity) VALUES (?, ?, ?, ?, ?)')
      .run('store-other', 'org-other', '別店舗', 'OTHER', 10);
    const own = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const session = await createAdminSession();

    const denied = await requestAs(
      '/api/restaurant-test/stores/store-other/select?account_id=account-1',
      session,
      {},
    );
    expect(denied.status).toBe(403);

    const selected = await requestAs(
      `/api/restaurant-test/stores/${own.id}/select?account_id=account-1`,
      session,
      {},
    );
    expect(selected.status).toBe(200);
    const scoped = await requestAs('/api/restaurant-test/snapshot?account_id=account-1', session);
    const scopedJson = await scoped.json() as { data: { stores: Array<{ id: string }> } };
    expect(scopedJson.data.stores.map((store) => store.id)).toEqual([own.id]);

    const cleared = await requestAs(
      '/api/restaurant-test/stores/selection/clear?account_id=account-1',
      session,
      {},
    );
    expect(cleared.status).toBe(200);
    const headquarters = await requestAs('/api/restaurant-test/snapshot?account_id=account-1', session);
    const headquartersJson = await headquarters.json() as { data: { stores: unknown[] } };
    expect(headquartersJson.data.stores).toHaveLength(2);
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

  it('発行済みアドレスを管理者だけに一覧し、再発行後も旧アドレスの失効予定を返す', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const first = await request('/api/restaurant-test/intake-addresses?account_id=account-1', { storeId: store.id });
      const firstJson = await first.json() as { data: { address: string } };
      const second = await request('/api/restaurant-test/intake-addresses?account_id=account-1', { storeId: store.id });
      const secondJson = await second.json() as { data: { address: string } };
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(secondJson.data.address).not.toBe(firstJson.data.address);

      authMocks.getStaffByApiKey.mockResolvedValue({
        id: 'admin-1',
        name: 'Admin',
        role: 'admin',
        access_level: 'full',
        permission_keys: '[]',
        assigned_line_account_id: null,
        can_access_descendant_accounts: 0,
      });
      const listed = await requestAs(
        `/api/restaurant-test/intake-addresses?account_id=account-1&storeId=${encodeURIComponent(store.id)}`,
        'admin-key',
      );
      expect(listed.status).toBe(200);
      const listedJson = await listed.json() as { data: Array<Record<string, unknown>> };
      expect(listedJson.data).toHaveLength(2);
      for (const item of listedJson.data) {
        expect(Object.keys(item).sort()).toEqual([
          'address', 'createdAt', 'id', 'localPart', 'revokedAt', 'status', 'storeId',
        ]);
        expect(item.status).toBe('active');
        expect(item.storeId).toBe(store.id);
      }
      const current = listedJson.data.find((item) => item.revokedAt === null);
      const retiring = listedJson.data.find((item) => typeof item.revokedAt === 'string');
      expect(current?.address).toBe(secondJson.data.address);
      expect(retiring?.address).toBe(firstJson.data.address);

      const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
      expect(logged).not.toContain(firstJson.data.address);
      expect(logged).not.toContain(secondJson.data.address);

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
        `/api/restaurant-test/intake-addresses?account_id=account-1&storeId=${encodeURIComponent(store.id)}`,
        'staff-key',
      );
      expect(denied.status).toBe(403);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('別組織の店舗の取り込みアドレスは一覧できない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, name) VALUES (?, ?, ?)')
      .run('org-other', 'account-other', '別組織');
    testDb.raw.prepare('INSERT INTO rt_stores (id, organization_id, name, code, capacity) VALUES (?, ?, ?, ?, ?)')
      .run('store-other', 'org-other', '別店舗', 'OTHER', 10);

    const response = await request('/api/restaurant-test/intake-addresses?account_id=account-1&storeId=store-other');
    expect(response.status).toBe(400);
  });

  it('取り込みドメイン未設定時は一覧と発行を503にする', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };
    env.RESTAURANT_INTAKE_DOMAIN = undefined;

    const listed = await request(`/api/restaurant-test/intake-addresses?account_id=account-1&storeId=${encodeURIComponent(store.id)}`);
    expect(listed.status).toBe(503);
    const issued = await request('/api/restaurant-test/intake-addresses?account_id=account-1', { storeId: store.id });
    expect(issued.status).toBe(503);
  });

  it('LINEアカウント未指定では店舗を作成できない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const response = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '新宿店', code: 'SHINJUKU', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo',
    });
    expect(response.status).toBe(400);
  });

  it('店舗名が空の場合は店舗を作成できない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const response = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '', code: 'EMPTY', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo', lineAccountId: 'account-4',
    });
    expect(response.status).toBe(400);
  });

  it('不正なチャネルシークレットを接続エラーやログへ含めない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const secret = 'invalid-secret-must-not-leak';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/oauth/accessToken')) {
        return new Response(JSON.stringify({ message: secret }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request('/api/restaurant-test/stores/connect?account_id=account-1', {
        name: '新店舗', alias: 'NEW', channelId: '1234567890', channelSecret: secret,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(secret);
      expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls])).not.toContain(secret);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('接続確認が成功した場合だけLINEアカウントと店舗をまとめて作成する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const secret = 'wizard-test-secret';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/accessToken')) {
        return new Response(JSON.stringify({
          access_token: 'wizard-access-token', expires_in: 2_592_000, token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/v2/bot/info')) {
        return new Response(JSON.stringify({ displayName: '新店舗公式LINE', basicId: '@newstore' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }));

    const response = await request('/api/restaurant-test/stores/connect?account_id=account-1', {
      name: '新店舗', alias: 'NEW', channelId: '1234567890', channelSecret: secret,
    });
    expect(response.status).toBe(201);
    const payload = await response.text();
    expect(payload).toContain('新店舗公式LINE');
    expect(payload).not.toContain(secret);
    expect(payload).not.toContain('wizard-access-token');
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_stores WHERE code = 'NEW'").get())
      .toMatchObject({ count: 1 });
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM line_accounts WHERE channel_id = '1234567890'").get())
      .toMatchObject({ count: 1 });
  });

  it('LINEアカウントを指定して店舗を作成・編集でき、スタッフは操作できない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const created = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '新宿店', code: 'SHINJUKU', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo', lineAccountId: 'account-4',
    });
    expect(created.status).toBe(201);
    const createdJson = await created.json() as { data: { id: string } };

    const updated = await requestWithMethod(
      `/api/restaurant-test/stores/${createdJson.data.id}?account_id=account-1`,
      'PATCH',
      { name: '新宿本店', status: 'paused', lineAccountId: 'account-4' },
    );
    expect(updated.status).toBe(200);
    expect(testDb.raw.prepare('SELECT name, status, line_account_id FROM rt_stores WHERE id = ?').get(createdJson.data.id))
      .toMatchObject({ name: '新宿本店', status: 'paused', line_account_id: 'account-4' });

    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'staff-1', name: 'Staff', role: 'staff', access_level: 'full',
      permission_keys: '[]', assigned_line_account_id: null,
      can_access_descendant_accounts: 0,
    });
    const denied = await requestWithMethod(
      `/api/restaurant-test/stores/${createdJson.data.id}?account_id=account-1`,
      'PATCH',
      { status: 'active' },
      'staff-key',
    );
    expect(denied.status).toBe(403);
  });

  it('同じLINEアカウントを2店舗へ割り当てず、同一組織の店舗コード重複も拒否する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const used = testDb.raw.prepare("SELECT line_account_id FROM rt_stores WHERE code = 'GINZA'").get() as { line_account_id: string };

    const duplicateAccount = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '新宿店', code: 'SHINJUKU', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo', lineAccountId: used.line_account_id,
    });
    expect(duplicateAccount.status).toBe(409);

    const duplicateCode = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '銀座別館', code: 'GINZA', area: '東京', capacity: 12,
      timezone: 'Asia/Tokyo', lineAccountId: 'account-4',
    });
    expect(duplicateCode.status).toBe(409);
  });

  it('他組織の店舗を更新できず、不正な店舗状態も拒否する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, name) VALUES (?, ?, ?)')
      .run('org-other', 'account-other', '別組織');
    testDb.raw.prepare('INSERT INTO rt_stores (id, organization_id, name, code, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('store-other', 'org-other', '別店舗', 'OTHER', 10, 'account-4');

    const other = await requestWithMethod(
      '/api/restaurant-test/stores/store-other?account_id=account-1',
      'PATCH',
      { status: 'archived' },
    );
    expect(other.status).toBe(400);

    const own = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const invalid = await requestWithMethod(
      `/api/restaurant-test/stores/${own.id}?account_id=account-1`,
      'PATCH',
      { status: 'deleted' },
    );
    expect(invalid.status).toBe(400);
  });

  it('店舗LINEアカウントではその店舗だけ、統括アカウントでは全店舗を返す', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const storeView = await request('/api/restaurant-test/snapshot?account_id=account-2');
    expect(storeView.status).toBe(200);
    const storeJson = await storeView.json() as { data: { stores: Array<{ id: string }>; reservations: Array<{ store_id: string }>; tables: Array<{ store_id: string }> } };
    expect(storeJson.data.stores).toHaveLength(1);
    expect(storeJson.data.reservations.every((item) => item.store_id === storeJson.data.stores[0].id)).toBe(true);
    expect(storeJson.data.tables.every((item) => item.store_id === storeJson.data.stores[0].id)).toBe(true);

    const organizationView = await request('/api/restaurant-test/snapshot?account_id=account-1');
    const organizationJson = await organizationView.json() as { data: { stores: unknown[] } };
    expect(organizationJson.data.stores).toHaveLength(2);
  });

  it('LINE未割当はunconfigured、Webhook不一致はwarningとして導出する', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const stores = testDb.raw.prepare('SELECT id, code FROM rt_stores ORDER BY code').all() as Array<{ id: string; code: string }>;
    testDb.raw.prepare('UPDATE rt_stores SET line_account_id = NULL WHERE id = ?').run(stores[0].id);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      endpoint: 'https://different.example.test/webhook', active: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request('/api/restaurant-test/snapshot?account_id=account-1');
      const json = await response.json() as { data: { stores: Array<{ id: string; line_status: string }> } };
      expect(json.data.stores.find((item) => item.id === stores[0].id)?.line_status).toBe('unconfigured');
      expect(json.data.stores.find((item) => item.id === stores[1].id)?.line_status).toBe('warning');
      expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls])).not.toContain('token-');
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('店舗をarchivedにしても既存予約を削除せず、DELETE経路も持たない', async () => {
    await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const before = testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations WHERE store_id = ?').get(store.id) as { count: number };
    const updated = await requestWithMethod(
      `/api/restaurant-test/stores/${store.id}?account_id=account-1`,
      'PATCH',
      { status: 'archived' },
    );
    expect(updated.status).toBe(200);
    const after = testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations WHERE store_id = ?').get(store.id) as { count: number };
    expect(after.count).toBe(before.count);

    const deleted = await requestWithMethod(
      `/api/restaurant-test/stores/${store.id}?account_id=account-1`,
      'DELETE',
    );
    expect(deleted.status).toBe(404);
  });

  it('bootstrap時に店舗へ割り当てるLINEアカウントが不足していれば何も作らない', async () => {
    authMocks.lineAccounts = authMocks.lineAccounts.slice(0, 2);
    const response = await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'LINEアカウントが不足しています' });
    const count = testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organizations').get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('この組織に存在しないLINEアカウントの飲食店データへアクセスさせない', async () => {
    const response = await request('/api/restaurant-test/snapshot?account_id=account-unknown');
    expect(response.status).toBe(403);
  });
});
