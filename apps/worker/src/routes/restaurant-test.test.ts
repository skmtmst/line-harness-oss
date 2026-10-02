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

const { authMiddleware, sha256Hex } = await import('../middleware/auth.js');
const { restaurantTest } = await import('./restaurant-test.js');
type Env = import('../index.js').Env;

const here = dirname(fileURLToPath(import.meta.url));
let testDb: SqliteD1;
let env: Env['Bindings'];

/** HTTPで公開しない、ルート試験専用の最小データ。 */
function seedRestaurantFixture({
  accountId = 'account-1',
  tenantId = '00000000-0000-4000-8000-000000000001',
  name = '飲食店LAB',
}: {
  accountId?: string;
  tenantId?: string;
  name?: string;
} = {}): void {
  // 統括ゲート（飲食店機能パック）。このAPI群はゲートの内側を検証する
  // フィクスチャなので、対象の統括には常にパックを付けておく。
  // ゲート自体の検証（無し→404）は別のdescribeで明示的に行う。
  testDb.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = ?`)
    .run(tenantId);
  testDb.raw.prepare(
    'INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)',
  ).run('org-fixture', accountId, tenantId, name);
  testDb.raw.prepare(
    'INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id, google_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('store-ginza', 'org-fixture', '銀座店', 'GINZA', '東京', 32, 'account-2', 'connected');
  testDb.raw.prepare(
    'INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('store-yokohama', 'org-fixture', '横浜店', 'YOKOHAMA', '神奈川', 24, 'account-3');
  testDb.raw.prepare(
    'INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('table-ginza', 'store-ginza', 'T-01', 'テーブル1', 'table', 1, 4);
  testDb.raw.prepare(
    'INSERT INTO rt_menu_items (id, store_id, kind, name, price) VALUES (?, ?, ?, ?, ?)',
  ).run('menu-ginza', 'store-ginza', 'course', 'テストコース', 8800);
  testDb.raw.prepare(
    'INSERT INTO rt_reservations (id, store_id, source, external_id, customer_name, guest_count, starts_at, ends_at, table_id, course_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'reservation-ginza',
    'store-ginza',
    'restaurant_board',
    'RB-FIXTURE',
    '検証 太郎',
    2,
    '2026-08-25T09:00:00.000Z',
    '2026-08-25T11:00:00.000Z',
    'table-ginza',
    'menu-ginza',
  );
  for (const [index, flowType] of [
    'reservation_24h',
    'reservation_2h',
    'post_visit',
    'review_request',
    'member_card',
    'one_tap_booking',
  ].entries()) {
    testDb.raw.prepare(
      'INSERT INTO rt_line_flows (id, organization_id, store_id, flow_type, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`flow-${index}`, 'org-fixture', 'store-ginza', flowType, `テスト${index}`, 'テスト本文');
  }
}

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
    RESTAURANT_TEST_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
});

describe('飲食店向けテストAPI', () => {
  it('無効な環境では専用APIを404にする', async () => {
    env.RESTAURANT_TEST_ENABLED = 'false';
    const response = await request('/api/restaurant-test/snapshot?account_id=account-1');
    expect(response.status).toBe(404);
  });

  it('統括に飲食店機能パックが無いと、環境が有効でも専用APIを404にする', async () => {
    // beforeEach で既定の統括へ付けたパックを外す。
    testDb.raw.prepare(`UPDATE tenants SET feature_packs = '[]' WHERE id = '00000000-0000-4000-8000-000000000001'`).run();
    seedRestaurantFixture();
    // seedRestaurantFixture は毎回パックを付け直すので、fixture後にも外す。
    testDb.raw.prepare(`UPDATE tenants SET feature_packs = '[]' WHERE id = '00000000-0000-4000-8000-000000000001'`).run();
    const response = await request('/api/restaurant-test/snapshot?account_id=account-1');
    expect(response.status).toBe(404);
  });

  it('既存領域と分離したテストデータを準備してR-1〜R-8の読取モデルを返す', async () => {
    seedRestaurantFixture({ name: '飲食店LAB' });

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
    seedRestaurantFixture({ name: '二重解決LAB' });
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
    seedRestaurantFixture({ accountId: tenant, tenantId: tenant, name: 'LINE非依存の統括' });
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

  it('tenant_id未設定の認証スタッフも既定以外のtenant_idを拒否する', async () => {
    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'legacy-admin', name: 'Legacy Admin', role: 'admin', access_level: 'full',
      permission_keys: '[]', assigned_line_account_id: null,
      can_access_descendant_accounts: 0,
      tenant_id: null,
    });
    const response = await requestAs(
      '/api/restaurant-test/snapshot?tenant_id=00000000-0000-4000-8000-000000000099',
      'legacy-admin-key',
    );
    expect(response.status).toBe(403);
  });

  it('店舗未選択の管理画面セッションでは統括組織の全店舗を返す', async () => {
    seedRestaurantFixture();
    const session = await createAdminSession();

    const snapshot = await requestAs('/api/restaurant-test/snapshot?account_id=account-1', session);
    expect(snapshot.status).toBe(200);
    const json = await snapshot.json() as { data: { stores: unknown[] } };
    expect(json.data.stores).toHaveLength(2);
  });

  it('利用規約への同意を組織・現行版ごとに冪等記録する', async () => {
    seedRestaurantFixture();
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

  it('組織が無くてもGETは未同意を返し、行を作らない', async () => {
    const first = await request('/api/restaurant-test/terms-agreement');
    const second = await request('/api/restaurant-test/terms-agreement');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      success: true,
      data: { documentKey: 'musubo-terms', agreedVersion: null, agreedAt: null },
    });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organizations').get())
      .toMatchObject({ count: 0 });
  });

  it('最初の規約同意時に認証スタッフの統括組織を1件だけ作る', async () => {
    const tenant = '00000000-0000-4000-8000-000000000099';
    testDb.raw.prepare(`INSERT INTO tenants (id, name, feature_packs) VALUES (?, ?, '["restaurant"]')`)
      .run(tenant, '新しい統括');
    authMocks.getStaffByApiKey.mockResolvedValue({
      id: 'new-owner', name: 'New Owner', role: 'owner', access_level: 'full',
      permission_keys: '[]', assigned_line_account_id: null,
      can_access_descendant_accounts: 0, tenant_id: tenant,
    });
    const body = { documentKey: 'musubo-terms', version: 'v0.1-draft' };
    const [first, second] = await Promise.all([
      requestAs('/api/restaurant-test/terms-agreement', 'new-owner-key', body),
      requestAs('/api/restaurant-test/terms-agreement', 'new-owner-key', body),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(testDb.raw.prepare(`SELECT account_id, tenant_id, name, status
      FROM rt_organizations`).all()).toEqual([{
      account_id: tenant,
      tenant_id: tenant,
      name: '新しい統括',
      status: 'active',
    }]);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organization_agreements').get())
      .toMatchObject({ count: 1 });
    const state = await requestAs('/api/restaurant-test/terms-agreement', 'new-owner-key');
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({
      success: true,
      data: { documentKey: 'musubo-terms', agreedVersion: 'v0.1-draft' },
    });
  });

  it('既存組織を作り直さずに規約同意を記録する', async () => {
    seedRestaurantFixture({ name: '既存組織' });
    const response = await request('/api/restaurant-test/terms-agreement', {
      documentKey: 'musubo-terms', version: 'v0.1-draft',
    });
    expect(response.status).toBe(200);
    expect(testDb.raw.prepare('SELECT id, name FROM rt_organizations').all())
      .toEqual([{ id: 'org-fixture', name: '既存組織' }]);
  });

  it('現行版以外の規約同意を拒否し、組織も作らない', async () => {
    const oldVersion = await request('/api/restaurant-test/terms-agreement?account_id=account-1', {
      documentKey: 'musubo-terms', version: 'v0.0-draft',
    });
    expect(oldVersion.status).toBe(400);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organizations').get())
      .toMatchObject({ count: 0 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organization_agreements').get())
      .toMatchObject({ count: 0 });
  });

  it('staffは規約状態を読めるが同意記録は作れない', async () => {
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };
    const response = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'outbound', eventId: 'event-x', reservation: {},
    });
    expect(response.status).toBe(400);
  });

  it('取り込みアドレスはオーナーだけが発行でき、スタッフは拒否する', async () => {
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
    testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, name) VALUES (?, ?, ?)')
      .run('org-other', 'account-other', '別組織');
    testDb.raw.prepare('INSERT INTO rt_stores (id, organization_id, name, code, capacity) VALUES (?, ?, ?, ?, ?)')
      .run('store-other', 'org-other', '別店舗', 'OTHER', 10);

    const response = await request('/api/restaurant-test/intake-addresses?account_id=account-1&storeId=store-other');
    expect(response.status).toBe(400);
  });

  it('取り込みドメイン未設定時は一覧と発行を503にする', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare('SELECT id FROM rt_stores LIMIT 1').get() as { id: string };
    env.RESTAURANT_INTAKE_DOMAIN = undefined;

    const listed = await request(`/api/restaurant-test/intake-addresses?account_id=account-1&storeId=${encodeURIComponent(store.id)}`);
    expect(listed.status).toBe(503);
    const issued = await request('/api/restaurant-test/intake-addresses?account_id=account-1', { storeId: store.id });
    expect(issued.status).toBe(503);
  });

  it('LINEアカウント未指定では店舗を作成できない', async () => {
    seedRestaurantFixture();
    const response = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '新宿店', code: 'SHINJUKU', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo',
    });
    expect(response.status).toBe(400);
  });

  it('店舗名が空の場合は店舗を作成できない', async () => {
    seedRestaurantFixture();
    const response = await request('/api/restaurant-test/stores?account_id=account-1', {
      name: '', code: 'EMPTY', area: '東京', capacity: 20,
      timezone: 'Asia/Tokyo', lineAccountId: 'account-4',
    });
    expect(response.status).toBe(400);
  });

  it('不正なチャネルシークレットを接続エラーやログへ含めない', async () => {
    seedRestaurantFixture();
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

    const response = await request('/api/restaurant-test/stores/connect', {
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
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_organizations').get())
      .toMatchObject({ count: 1 });
    expect(testDb.raw.prepare(`SELECT la.tenant_id AS line_tenant, o.tenant_id AS organization_tenant
      FROM line_accounts la
      JOIN rt_stores s ON s.line_account_id = la.id
      JOIN rt_organizations o ON o.id = s.organization_id
      WHERE la.channel_id = '1234567890'`).get()).toEqual({
        line_tenant: '00000000-0000-4000-8000-000000000001',
        organization_tenant: '00000000-0000-4000-8000-000000000001',
      });
  });

  it('LINEアカウントを指定して店舗を作成・編集でき、スタッフは操作できない', async () => {
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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
    seedRestaurantFixture();
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

  it('デモ用bootstrap APIを公開しない', async () => {
    // D-3: テストデータ作成を管理画面や公開APIへ戻さないための退行防止。
    const response = await request('/api/restaurant-test/bootstrap?account_id=account-1', {});
    expect(response.status).toBe(404);
  });

  it('この組織に存在しないLINEアカウントの飲食店データへアクセスさせない', async () => {
    const response = await request('/api/restaurant-test/snapshot?account_id=account-unknown');
    expect(response.status).toBe(403);
  });

  it('R100: 同じ卓・重なる時間の予約は2件目を409にし、在庫を人数分だけ増やす', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    testDb.raw.prepare(
      'INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('table-2seat', store.id, 'T-02', 'テーブル2', 'table', 1, 2);
    testDb.raw.prepare(
      'INSERT INTO rt_inventory_slots (id, store_id, starts_at, total_capacity, ota_capacity, line_capacity, walk_in_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('slot-r100', store.id, '2026-09-10T10:00:00.000Z', 10, 4, 4, 2);
    const body = {
      storeId: store.id, customerName: '重複 太郎', guestCount: 2,
      startsAt: '2026-09-10T10:00:00.000Z', endsAt: '2026-09-10T12:00:00.000Z',
    };
    const first = await request('/api/restaurant-test/reservations/manual?account_id=account-1', body);
    expect(first.status).toBe(201);
    const second = await request('/api/restaurant-test/reservations/manual?account_id=account-1', {
      ...body, customerName: '重複 次郎',
    });
    expect(second.status).toBe(409);
    const count = testDb.raw.prepare(
      'SELECT COUNT(*) AS count FROM rt_reservations WHERE store_id = ? AND starts_at = ?',
    ).get(store.id, '2026-09-10T10:00:00.000Z') as { count: number };
    expect(count.count).toBe(1);
    const slot = testDb.raw.prepare(
      'SELECT reserved_count FROM rt_inventory_slots WHERE id = ?',
    ).get('slot-r100') as { reserved_count: number };
    expect(slot.reserved_count).toBe(2);
  });

  it('R100: 重ならない時間・別の卓の予約は登録できる', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const first = await request('/api/restaurant-test/reservations/manual?account_id=account-1', {
      storeId: store.id, customerName: '昼 太郎', guestCount: 2,
      startsAt: '2026-09-10T10:00:00.000Z', endsAt: '2026-09-10T12:00:00.000Z',
    });
    expect(first.status).toBe(201);
    const later = await request('/api/restaurant-test/reservations/manual?account_id=account-1', {
      storeId: store.id, customerName: '夜 花子', guestCount: 2,
      startsAt: '2026-09-10T12:00:00.000Z', endsAt: '2026-09-10T14:00:00.000Z',
    });
    expect(later.status).toBe(201);
  });

  it('R101: 失敗した連携イベントの再送は予約を取り込む', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    testDb.raw.prepare(
      'INSERT INTO rt_sync_events (id, store_id, provider, external_event_id, payload_json, status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('event-failed', store.id, 'restaurant_board', 'event-retry-1', '{}', 'failed', 'boom');
    const retry = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'restaurant_board', eventId: 'event-retry-1',
      reservation: {
        externalId: 'RB-RETRY', customerName: '再送 太郎', guestCount: 2,
        startsAt: '2026-09-11T10:00:00.000Z', endsAt: '2026-09-11T12:00:00.000Z',
      },
    });
    expect(retry.status).toBe(201);
    const count = testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_reservations WHERE external_id = 'RB-RETRY'").get() as { count: number };
    expect(count.count).toBe(1);
    const event = testDb.raw.prepare('SELECT status FROM rt_sync_events WHERE id = ?').get('event-failed') as { status: string };
    expect(event.status).toBe('processed');
  });

  it('R102: 古い連携通知は取消済み予約を確定に戻さない', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const cancel = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'restaurant_board', eventId: 'event-new-1',
      reservation: {
        externalId: 'RB-STALE', customerName: '取消 太郎', guestCount: 2,
        startsAt: '2026-09-12T10:00:00.000Z', endsAt: '2026-09-12T12:00:00.000Z',
        status: 'cancelled', sourceUpdatedAt: '2026-09-12T10:00:00.000Z',
      },
    });
    expect(cancel.status).toBe(201);
    const stale = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'restaurant_board', eventId: 'event-old-1',
      reservation: {
        externalId: 'RB-STALE', customerName: '取消 太郎', guestCount: 2,
        startsAt: '2026-09-12T10:00:00.000Z', endsAt: '2026-09-12T12:00:00.000Z',
        status: 'confirmed', sourceUpdatedAt: '2026-09-12T09:00:00.000Z',
      },
    });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ data: { stale: true } });
    const row = testDb.raw.prepare("SELECT status FROM rt_reservations WHERE external_id = 'RB-STALE'").get() as { status: string };
    expect(row.status).toBe('cancelled');
  });

  it('R103: 予約台帳を期間・状態で絞り込み総件数とページを返す', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const rows = [
      ['past-1', '2026-01-10T10:00:00.000Z', 'visited'],
      ['future-1', '2026-12-10T10:00:00.000Z', 'confirmed'],
      ['future-2', '2026-12-11T10:00:00.000Z', 'cancelled'],
    ] as const;
    for (const [id, startsAt, status] of rows) {
      testDb.raw.prepare(
        'INSERT INTO rt_reservations (id, store_id, source, external_id, customer_name, guest_count, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, store.id, 'manual', `EXT-${id}`, '絞込 太郎', 2, startsAt, '2026-12-10T12:00:00.000Z', status);
    }
    const upcoming = await request('/api/restaurant-test/snapshot?account_id=account-1&reservationFrom=2026-06-01');
    const upcomingJson = await upcoming.json() as { data: { reservations: Array<{ id: string }>; reservationTotal: number } };
    expect(upcomingJson.data.reservationTotal).toBe(3);
    expect(upcomingJson.data.reservations.map((item) => item.id).sort()).toEqual(['future-1', 'future-2', 'reservation-ginza'].sort());

    const cancelled = await request('/api/restaurant-test/snapshot?account_id=account-1&reservationStatus=cancelled');
    const cancelledJson = await cancelled.json() as { data: { reservations: Array<{ id: string }>; reservationTotal: number } };
    expect(cancelledJson.data.reservationTotal).toBe(1);
    expect(cancelledJson.data.reservations[0].id).toBe('future-2');

    const page = await request('/api/restaurant-test/snapshot?account_id=account-1&reservationFrom=2026-06-01&reservationLimit=1&reservationOffset=1');
    const pageJson = await page.json() as { data: { reservations: unknown[]; reservationTotal: number } };
    expect(pageJson.data.reservationTotal).toBe(3);
    expect(pageJson.data.reservations).toHaveLength(1);

    const bad = await request('/api/restaurant-test/snapshot?account_id=account-1&reservationStatus=deleted');
    expect(bad.status).toBe(400);
  });

  it('R107: 予約の人数・日時・卓の変更と取消で在庫が連動する', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    testDb.raw.prepare(
      'INSERT INTO rt_inventory_slots (id, store_id, starts_at, total_capacity, ota_capacity, line_capacity, walk_in_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('slot-r107', store.id, '2026-10-10T10:00:00.000Z', 10, 4, 4, 2);
    const created = await request('/api/restaurant-test/reservations/manual?account_id=account-1', {
      storeId: store.id, customerName: '変更 太郎', guestCount: 2,
      startsAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-10T12:00:00.000Z',
    });
    expect(created.status).toBe(201);
    const { data: createdData } = await created.json() as { data: { id: string } };
    const id = createdData.id;
    const slotOf = () => (testDb.raw.prepare('SELECT reserved_count FROM rt_inventory_slots WHERE id = ?').get('slot-r107') as { reserved_count: number }).reserved_count;
    expect(slotOf()).toBe(2);

    const grown = await requestWithMethod(`/api/restaurant-test/reservations/${id}?account_id=account-1`, 'PATCH', { guestCount: 3 });
    expect(grown.status).toBe(200);
    expect(slotOf()).toBe(3);

    const cancelled = await requestWithMethod(`/api/restaurant-test/reservations/${id}?account_id=account-1`, 'PATCH', { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(slotOf()).toBe(0);

    const restored = await requestWithMethod(`/api/restaurant-test/reservations/${id}?account_id=account-1`, 'PATCH', { status: 'confirmed' });
    expect(restored.status).toBe(200);
    expect(slotOf()).toBe(3);

    const missing = await requestWithMethod('/api/restaurant-test/reservations/no-such-id?account_id=account-1', 'PATCH', { guestCount: 2 });
    expect(missing.status).toBe(404);
    const badCount = await requestWithMethod(`/api/restaurant-test/reservations/${id}?account_id=account-1`, 'PATCH', { guestCount: 0 });
    expect(badCount.status).toBe(400);
  });

  it('R107: 重なる卓への変更は409にする', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    testDb.raw.prepare(
      'INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('table-fixed', store.id, 'T-09', '固定卓', 'table', 1, 8);
    const first = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'restaurant_board', eventId: 'event-seat-a',
      reservation: {
        externalId: 'RB-SEAT-A', customerName: '先客 太郎', guestCount: 2,
        startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z',
        tableId: 'table-fixed',
      },
    });
    expect(first.status).toBe(201);
    const second = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      storeId: store.id, provider: 'restaurant_board', eventId: 'event-seat-b',
      reservation: {
        externalId: 'RB-SEAT-B', customerName: '後客 次郎', guestCount: 2,
        startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z',
      },
    });
    expect(second.status).toBe(201);
    const { data } = await (await request('/api/restaurant-test/snapshot?account_id=account-1')).json() as { data: { reservations: Array<{ id: string; external_id: string }> } };
    const target = data.reservations.find((item) => item.external_id === 'RB-SEAT-B');
    expect(target).toBeDefined();
    const conflict = await requestWithMethod(`/api/restaurant-test/reservations/${target!.id}?account_id=account-1`, 'PATCH', { tableId: 'table-fixed' });
    expect(conflict.status).toBe(409);
  });

  it('R107: 卓を変更・停止・再開しても予約の参照を残し、別組織の卓は変更しない', async () => {
    seedRestaurantFixture();
    const path = '/api/restaurant-test/tables/table-ginza?account_id=account-1';
    expect((await requestWithMethod(path, 'PATCH', { code: 'T-10', label: '窓際', seatType: 'counter', minCapacity: 1, maxCapacity: 2 })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { isActive: false })).status).toBe(200);
    expect(testDb.raw.prepare('SELECT code, label, seat_type, is_active FROM rt_tables WHERE id = ?').get('table-ginza')).toEqual({ code: 'T-10', label: '窓際', seat_type: 'counter', is_active: 0 });
    expect(testDb.raw.prepare('SELECT table_id FROM rt_reservations WHERE id = ?').get('reservation-ginza')).toEqual({ table_id: 'table-ginza' });
    const stoppedBooking = await request('/api/restaurant-test/reservations/manual?account_id=account-1', { storeId: 'store-ginza', customerName: '停止確認', guestCount: 2, startsAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-10T12:00:00.000Z', tableId: 'table-ginza' });
    expect(stoppedBooking.status).toBe(400);
    const inbound = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', { storeId: 'store-ginza', provider: 'restaurant_board', eventId: 'stopped-table', reservation: { externalId: 'RB-STOP-T', customerName: '停止確認', guestCount: 2, startsAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-10T12:00:00.000Z', tableId: 'table-ginza' } });
    expect(inbound.status).toBe(400);
    expect(testDb.raw.prepare("SELECT status FROM rt_sync_events WHERE external_event_id = 'stopped-table'").get()).toEqual({ status: 'failed' });
    expect((await requestWithMethod(path, 'PATCH', { isActive: true })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { minCapacity: 3, maxCapacity: 2 })).status).toBe(400);
    expect((await requestWithMethod('/api/restaurant-test/tables/table-ginza?account_id=account-4', 'PATCH', { label: '改ざん' })).status).not.toBe(200);
  });

  it('R107: メニューを変更・保管・再開しても予約の参照を残す', async () => {
    seedRestaurantFixture();
    const path = '/api/restaurant-test/menu/menu-ginza?account_id=account-1';
    expect((await requestWithMethod(path, 'PATCH', { name: '新コース', kind: 'course', price: 9900, allergens: ['卵'], servicePeriods: ['lunch'] })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { status: 'archived' })).status).toBe(200);
    expect(testDb.raw.prepare('SELECT name, price, status, allergens_json FROM rt_menu_items WHERE id = ?').get('menu-ginza')).toEqual({ name: '新コース', price: 8800, status: 'archived', allergens_json: '["卵"]' });
    expect(testDb.raw.prepare('SELECT course_id FROM rt_reservations WHERE id = ?').get('reservation-ginza')).toEqual({ course_id: 'menu-ginza' });
    const stoppedBooking = await request('/api/restaurant-test/reservations/manual?account_id=account-1', { storeId: 'store-ginza', customerName: '停止確認', guestCount: 2, startsAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-10T12:00:00.000Z', courseId: 'menu-ginza' });
    expect(stoppedBooking.status).toBe(400);
    const inbound = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', { storeId: 'store-ginza', provider: 'restaurant_board', eventId: 'stopped-course', reservation: { externalId: 'RB-STOP-C', customerName: '停止確認', guestCount: 2, startsAt: '2026-10-10T10:00:00.000Z', endsAt: '2026-10-10T12:00:00.000Z', courseId: 'menu-ginza' } });
    expect(inbound.status).toBe(400);
    expect((await requestWithMethod(path, 'PATCH', { status: 'active' })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { price: -1 })).status).toBe(400);
  });

  it('R107: 所属ユーザーの変更・停止・再開と権限の境界', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_memberships (id, organization_id, store_id, staff_name, role) VALUES ('member-ginza', 'org-fixture', 'store-ginza', '旧名', 'staff')").run();
    const path = '/api/restaurant-test/memberships/member-ginza?account_id=account-1';
    expect((await requestWithMethod(path, 'PATCH', { staffName: '新名', role: 'store_manager', email: 'new@example.test' })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { status: 'suspended' })).status).toBe(200);
    expect(testDb.raw.prepare('SELECT staff_name, role, status FROM rt_memberships WHERE id = ?').get('member-ginza')).toEqual({ staff_name: '新名', role: 'store_manager', status: 'suspended' });
    expect((await requestWithMethod(path, 'PATCH', { status: 'active' })).status).toBe(200);
    expect((await requestWithMethod(path, 'PATCH', { storeId: 'no-such-store' })).status).toBe(400);
    authMocks.getStaffByApiKey.mockResolvedValue({ id: 'admin-test', name: '管理者', role: 'admin', access_level: 'full', permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1 });
    expect((await requestWithMethod(path, 'PATCH', { role: 'super_admin' }, 'admin-key')).status).toBe(403);
  });

  it('R107: 店舗を選択した管理者は別店舗の卓・メニュー・所属ユーザーを更新できない', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES ('table-yokohama', 'store-yokohama', 'Y1', '横浜卓', 'table', 1, 4)").run();
    testDb.raw.prepare("INSERT INTO rt_menu_items (id, store_id, kind, name, price) VALUES ('menu-yokohama', 'store-yokohama', 'course', '横浜コース', 2000)").run();
    testDb.raw.prepare("INSERT INTO rt_memberships (id, organization_id, store_id, staff_name, role) VALUES ('member-yokohama', 'org-fixture', 'store-yokohama', '横浜スタッフ', 'staff')").run();
    const session = await createAdminSession();
    expect((await requestAs('/api/restaurant-test/stores/store-ginza/select?account_id=account-1', session, {})).status).toBe(200);
    for (const [entity, id, body] of [
      ['tables', 'table-yokohama', { label: '改ざん' }],
      ['menu', 'menu-yokohama', { name: '改ざん' }],
      ['memberships', 'member-yokohama', { staffName: '改ざん' }],
    ] as const) {
      expect((await requestWithMethod(`/api/restaurant-test/${entity}/${id}?account_id=account-1`, 'PATCH', body, session)).status).toBe(404);
    }
    expect((await requestWithMethod('/api/restaurant-test/memberships/member-yokohama?account_id=account-1', 'PATCH', { storeId: 'store-ginza' }, session)).status).toBe(404);
    expect(testDb.raw.prepare("SELECT staff_name FROM rt_memberships WHERE id = 'member-yokohama'").get()).toEqual({ staff_name: '横浜スタッフ' });
  });

  it('R102: 新しい連携通知は予約を更新する', async () => {
    seedRestaurantFixture();
    const store = testDb.raw.prepare("SELECT id FROM rt_stores WHERE code = 'GINZA'").get() as { id: string };
    const base = {
      storeId: store.id, provider: 'restaurant_board',
      reservation: {
        externalId: 'RB-FRESH', customerName: '更新 太郎', guestCount: 2,
        startsAt: '2026-09-13T10:00:00.000Z', endsAt: '2026-09-13T12:00:00.000Z',
        status: 'confirmed', sourceUpdatedAt: '2026-09-13T09:00:00.000Z',
      },
    };
    expect((await request('/api/restaurant-test/inbound/reservations?account_id=account-1', { ...base, eventId: 'event-fresh-1' })).status).toBe(201);
    const newer = await request('/api/restaurant-test/inbound/reservations?account_id=account-1', {
      ...base, eventId: 'event-fresh-2',
      reservation: { ...base.reservation, guestCount: 4, sourceUpdatedAt: '2026-09-13T10:00:00.000Z' },
    });
    expect(newer.status).toBe(201);
    const row = testDb.raw.prepare("SELECT guest_count FROM rt_reservations WHERE external_id = 'RB-FRESH'").get() as { guest_count: number };
    expect(row.guest_count).toBe(4);
  });
});


describe('V8-B メニューの価格承認', () => {
  const menuPath = '/api/restaurant-test/menus/menu-ginza?account_id=account-1';
  it('価格は申請中に保ち、承認時に一度だけ反映する', async () => {
    seedRestaurantFixture();
    const response = await requestWithMethod(menuPath, 'PATCH', { price: 9900 });
    expect(response.status).toBe(200);
    const { data } = await response.json() as any;
    expect(data.pendingPrice).toBe(9900);
    expect(testDb.raw.prepare("SELECT price FROM rt_menu_items WHERE id = 'menu-ginza'").get()).toEqual({ price: 8800 });
    const list = await request('/api/restaurant-test/menus?account_id=account-1&storeId=store-ginza');
    expect((await list.json() as any).data[0].pendingPrice).toBe(9900);
    const snapshot = await request('/api/restaurant-test/snapshot?account_id=account-1');
    expect((await snapshot.json() as any).data.menuItems[0].pendingPrice).toBe(9900);
    expect((await requestWithMethod(menuPath, 'PATCH', { name: '二重申請', price: 10000 })).status).toBe(409);
    expect(testDb.raw.prepare("SELECT name FROM rt_menu_items WHERE id = 'menu-ginza'").get()).toEqual({ name: 'テストコース' });
    const approval = `/api/restaurant-test/approvals/${data.approvalId}?account_id=account-1`;
    const approved = await requestWithMethod(approval, 'PATCH', { action: 'approve' });
    expect((await approved.json() as any).data.menuChangeStatus).toBe('applied');
    expect(testDb.raw.prepare("SELECT price FROM rt_menu_items WHERE id = 'menu-ginza'").get()).toEqual({ price: 9900 });
    expect((await requestWithMethod(approval, 'PATCH', { action: 'approve' })).status).toBe(409);
    expect((await requestWithMethod(approval, 'PATCH', { action: 'return', comment: '戻す' })).status).toBe(409);
    expect(testDb.raw.prepare("SELECT before_price, after_price, requested_by, status FROM rt_menu_change_requests").get()).toMatchObject({ before_price: 8800, after_price: 9900, status: 'applied' });
  });
  it('差し戻しには理由が必要で、価格を変えず再申請できる', async () => {
    seedRestaurantFixture();
    const { data } = await (await requestWithMethod(menuPath, 'PATCH', { price: 9900 })).json() as any;
    const path = `/api/restaurant-test/approvals/${data.approvalId}?account_id=account-1`;
    expect((await requestWithMethod(path, 'PATCH', { action: 'return' })).status).toBe(400);
    expect((await requestWithMethod(path, 'PATCH', { action: 'return', comment: '金額を再確認してください' })).status).toBe(200);
    expect(testDb.raw.prepare('SELECT status, return_reason FROM rt_menu_change_requests').get()).toEqual({ status: 'returned', return_reason: '金額を再確認してください' });
    expect(testDb.raw.prepare("SELECT price FROM rt_menu_items WHERE id = 'menu-ginza'").get()).toEqual({ price: 8800 });
    expect((await requestWithMethod(menuPath, 'PATCH', { price: 9500 })).status).toBe(200);
  });
  it('申請後に価格が変わっていたら上書きせず失敗を記録する', async () => {
    seedRestaurantFixture();
    const { data } = await (await requestWithMethod(menuPath, 'PATCH', { price: 9900 })).json() as any;
    testDb.raw.prepare("UPDATE rt_menu_items SET price = 9000 WHERE id = 'menu-ginza'").run();
    const res = await requestWithMethod(`/api/restaurant-test/approvals/${data.approvalId}?account_id=account-1`, 'PATCH', { action: 'approve' });
    expect((await res.json() as any).data).toMatchObject({ status: 'approved', menuChangeStatus: 'failed' });
    expect(testDb.raw.prepare("SELECT price FROM rt_menu_items WHERE id = 'menu-ginza'").get()).toEqual({ price: 9000 });
  });
  it('未公開の下書きだけ削除でき、公開後に下書きへ戻しても削除できない', async () => {
    seedRestaurantFixture();
    const create = () => request('/api/restaurant-test/menu?account_id=account-1', { storeId: 'store-ginza', kind: 'course', name: '下書き', price: 1000, status: 'draft' });
    const first = (await (await create()).json() as any).data.id;
    expect((await requestWithMethod(`/api/restaurant-test/menus/${first}?account_id=account-1`, 'DELETE')).status).toBe(200);
    const id = (await (await create()).json() as any).data.id;
    const path = `/api/restaurant-test/menus/${id}?account_id=account-1`;
    await requestWithMethod(path, 'PATCH', { status: 'active' });
    await requestWithMethod(path, 'PATCH', { status: 'draft' });
    expect((await requestWithMethod(path, 'DELETE')).status).toBe(409);
    expect((await requestWithMethod(menuPath, 'DELETE')).status).toBe(409);
  });
  it('他店舗からの申請・削除を拒否する', async () => {
    seedRestaurantFixture();
    const token = await createAdminSession();
    expect((await requestAs('/api/restaurant-test/stores/store-yokohama/select?account_id=account-1', token, {})).status).toBe(200);
    expect((await requestWithMethod(menuPath, 'PATCH', { price: 9999 }, token)).status).toBe(404);
    expect((await requestWithMethod(menuPath, 'DELETE', undefined, token)).status).toBe(404);
  });
});
