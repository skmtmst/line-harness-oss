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
const { restaurantGoogle } = await import('./restaurant-google.js');
const { decryptCredential, encryptCredential } = await import('@line-crm/db');
type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
const LOCATION = 'accounts/111/locations/222';
const ENC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let testDb: SqliteD1;
let env: Env['Bindings'];
let googleCalls: Array<{ url: string; init?: RequestInit }>;
let googleHandler: (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function seedStore(): void {
  testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)').run('org-1', 'account-1', TENANT, '飲食店LAB');
  testDb.raw
    .prepare('INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('store-shibuya', 'org-1', 'こもれび食堂 渋谷店', 'SHIBUYA', '東京', 20, 'account-2');
}

async function seedConnection(overrides: Partial<{ status: string; location_name: string | null; expires: string }> = {}): Promise<void> {
  testDb.raw
    .prepare(
      `INSERT INTO rt_google_connections
        (id, store_id, line_account_id, google_account_email, location_name, location_title, refresh_token_enc, access_token_enc, access_token_expires_at, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'conn-1',
      'store-shibuya',
      'account-2',
      'owner@example.test',
      overrides.location_name === undefined ? LOCATION : overrides.location_name,
      'こもれび食堂 渋谷店',
      await encryptCredential('refresh-secret', ENC_KEY),
      await encryptCredential('access-secret', ENC_KEY),
      overrides.expires ?? '2099-01-01T00:00:00.000Z',
      overrides.status ?? 'connected',
      '2026-09-23T00:00:00.000Z',
    );
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantGoogle);
  return instance;
}

function call(path: string, init: { method?: string; body?: unknown; token?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token ?? 'owner-key'}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return app().request(
    path,
    { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
    env,
  );
}

function useStaffRole(role: 'admin' | 'staff', accountScope: 'all' | 'accounts' = 'all'): void {
  testDb.raw
    .prepare(
      `INSERT OR REPLACE INTO staff_members
         (id, name, role, api_key, tenant_id, account_scope, can_access_descendant_accounts, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(`${role}-1`, role, role, `${role}-key`, TENANT, accountScope, accountScope === 'all' ? 1 : 0);
  authMocks.getStaffByApiKey.mockResolvedValue({
    id: `${role}-1`, name: role, role, access_level: 'full', permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1,
  });
}

const reviewPage = {
  reviews: [
    { name: `${LOCATION}/reviews/r1`, reviewId: 'r1', reviewer: { displayName: 'Aki' }, starRating: 'FIVE', comment: '季節の定食がおいしかった', createTime: '2026-09-23T01:42:00Z' },
    { name: `${LOCATION}/reviews/r2`, reviewId: 'r2', reviewer: { displayName: 'T.K.' }, starRating: 'THREE', comment: '営業中なのに閉まっていた', createTime: '2026-09-22T01:00:00Z' },
    { name: `${LOCATION}/reviews/r3`, reviewId: 'r3', reviewer: { displayName: 'Miki' }, starRating: 'FOUR', createTime: '2026-09-21T01:00:00Z', reviewReply: { comment: '返信済みです', updateTime: '2026-09-21T02:00:00Z' } },
  ],
  averageRating: 4.6,
  totalReviewCount: 3,
};

beforeEach(() => {
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.getStaffByAdminSession.mockReset();
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '渋谷店', is_active: 1, channel_access_token: 'token-2' },
    { id: 'account-9', name: '他社', is_active: 1, channel_access_token: 'token-9' },
  ];
  testDb = createTestD1();
  googleCalls = [];
  googleHandler = () => jsonResponse({}, 404);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      googleCalls.push({ url, init });
      return googleHandler(url, init);
    }),
  );
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    RESTAURANT_TEST_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    ADMIN_PUBLIC_URL: 'https://admin.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENC_KEY,
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_BUSINESS_WRITE_ENABLED: 'true',
  } as Env['Bindings'];
});

describe('Googleビジネス：設定（接続）', () => {
  it('店舗未登録のLINEアカウントは1店舗として初期化し、接続画面を表示できる', async () => {
    testDb.raw
      .prepare(
        `INSERT INTO line_accounts
          (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run('account-1', 'channel-1', '然-NEN-TEST', 'token', 'secret', TENANT);

    const response = await call('/api/restaurant-test/google/connection?account_id=account-1');
    expect(response.status).toBe(200);
    const json = (await response.json()) as { store: { name: string; lineAccountId: string }; connection: { status: string } };
    expect(json.store).toMatchObject({ name: '然-NEN-TEST', lineAccountId: 'account-1' });
    expect(json.connection.status).toBe('disconnected');

    const secondResponse = await call('/api/restaurant-test/google/connection?account_id=account-1');
    expect(secondResponse.status).toBe(200);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_organizations WHERE tenant_id = ?').get(TENANT)).toEqual({ n: 1 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_stores WHERE line_account_id = ?').get('account-1')).toEqual({ n: 1 });
  });

  it('未接続の店舗は disconnected を返し、トークンを含まない', async () => {
    seedStore();
    const response = await call('/api/restaurant-test/google/connection?account_id=account-2');
    expect(response.status).toBe(200);
    const json = (await response.json()) as { connection: { status: string }; writeEnabled: boolean; oauthConfigured: boolean; permissions: { canManageConnection: boolean; canPublishReply: boolean } };
    expect(json.connection.status).toBe('disconnected');
    expect(json.writeEnabled).toBe(true);
    expect(json.oauthConfigured).toBe(true);
    expect(json.permissions).toEqual({ canManageConnection: true, canPublishReply: true });
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('接続開始は state を保存し、Cookie と認可URLを返す（owner と全店担当の統括管理者）', async () => {
    seedStore();
    const denied = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {}, token: 'admin-key' });
    expect(denied.status).toBe(401);
    useStaffRole('admin');
    const adminAllowed = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {}, token: 'admin-key' });
    expect(adminAllowed.status).toBe(200);
    useStaffRole('admin', 'accounts');
    const scopedAdminDenied = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {}, token: 'admin-key' });
    expect(scopedAdminDenied.status).toBe(403);
    authMocks.getStaffByApiKey.mockResolvedValue(null);

    const response = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {} });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { authorizeUrl: string; mode: string };
    const url = new URL(json.authorizeUrl);
    const state = url.searchParams.get('state')!;
    expect(json.mode).toBe('connect');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('set-cookie')).toContain(`lh_gb_state=${state}`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const row = testDb.raw.prepare('SELECT store_id, mode, code_verifier_enc FROM rt_google_oauth_states WHERE state = ?').get(state) as { store_id: string; mode: string; code_verifier_enc: string };
    expect(row.store_id).toBe('store-shibuya');
    expect(row.code_verifier_enc.startsWith('v1.')).toBe(true);
  });

  async function startAndCallback(callbackQuery: (state: string) => string, cookie?: (state: string) => string) {
    const start = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {} });
    const state = new URL(((await start.json()) as { authorizeUrl: string }).authorizeUrl).searchParams.get('state')!;
    return call(`/api/restaurant-test/google/oauth/callback?${callbackQuery(state)}`, { cookie: cookie ? cookie(state) : `lh_gb_state=${state}` });
  }

  it('コールバック：state 一致・店舗1件なら接続済みにし、トークンを暗号化して保存する', async () => {
    seedStore();
    googleHandler = (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        expect(String(init?.body)).toContain('code_verifier=');
        return jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
      }
      if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return jsonResponse({ email: 'owner@example.test' });
      if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) return jsonResponse({ accounts: [{ name: 'accounts/111' }] });
      if (url.includes('/v1/accounts/111/locations')) return jsonResponse({ locations: [{ name: 'locations/222', title: 'こもれび食堂 渋谷店', metadata: { mapsUri: 'https://maps.google.com/?cid=1' } }] });
      return jsonResponse({}, 404);
    };
    const response = await startAndCallback((state) => `state=${state}&code=auth-code`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://admin.example.test/restaurant-test/google');
    expect(location.searchParams.get('google')).toBe('connected');
    expect(location.searchParams.get('account_id')).toBe('account-2');

    const row = testDb.raw.prepare('SELECT * FROM rt_google_connections WHERE store_id = ?').get('store-shibuya') as Record<string, string>;
    expect(row.status).toBe('connected');
    expect(row.location_name).toBe(LOCATION);
    expect(row.google_account_email).toBe('owner@example.test');
    expect(row.refresh_token_enc.startsWith('v1.')).toBe(true);
    expect(row.refresh_token_enc).not.toContain('refresh-1');
    expect(await decryptCredential(row.refresh_token_enc, ENC_KEY)).toBe('refresh-1');
    expect(testDb.raw.prepare('SELECT used_at FROM rt_google_oauth_states').get()).toMatchObject({ used_at: expect.any(String) });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_write_log WHERE kind = ?').get('connect')).toEqual({ n: 1 });
  });

  it('コールバック：Cookie の state が違えば保存しない', async () => {
    seedStore();
    const response = await startAndCallback((state) => `state=${state}&code=auth-code`, () => 'lh_gb_state=other');
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).searchParams.get('google')).toBe('error:invalid_state');
    expect(googleCalls).toHaveLength(0);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_connections').get()).toEqual({ n: 0 });
  });

  it('コールバック：店舗が複数なら候補を保存して選択待ちにし、選択で接続済みになる', async () => {
    seedStore();
    googleHandler = (url) => {
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.includes('userinfo')) return jsonResponse({ email: 'owner@example.test' });
      if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) return jsonResponse({ accounts: [{ name: 'accounts/111' }] });
      if (url.includes('/locations')) return jsonResponse({ locations: [{ name: 'locations/222', title: '渋谷店' }, { name: 'locations/333', title: '新宿店' }] });
      return jsonResponse({}, 404);
    };
    const response = await startAndCallback((state) => `state=${state}&code=c`);
    expect(new URL(response.headers.get('location')!).searchParams.get('google')).toBe('select_location');
    const connection = await call('/api/restaurant-test/google/connection?account_id=account-2');
    const json = (await connection.json()) as { connection: { status: string }; candidates: Array<{ locationName: string }> };
    expect(json.connection.status).toBe('pending_location');
    expect(json.candidates.map((c) => c.locationName)).toEqual(['accounts/111/locations/333', 'accounts/111/locations/222']);

    const bad = await call('/api/restaurant-test/google/connect/select-location?account_id=account-2', { body: { locationName: 'accounts/999/locations/1' } });
    expect(bad.status).toBe(400);
    const ok = await call('/api/restaurant-test/google/connect/select-location?account_id=account-2', { body: { locationName: 'accounts/111/locations/222' } });
    expect(ok.status).toBe(200);
    expect(testDb.raw.prepare('SELECT status, location_title FROM rt_google_connections').get()).toEqual({ status: 'connected', location_title: '渋谷店' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_location_candidates').get()).toEqual({ n: 0 });
  });

  it('再接続：別の店舗が選ばれたら保存せずに止める', async () => {
    seedStore();
    await seedConnection();
    googleHandler = (url) => {
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 });
      if (url.includes('userinfo')) return jsonResponse({ email: 'other@example.test' });
      if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) return jsonResponse({ accounts: [{ name: 'accounts/555' }] });
      if (url.includes('/locations')) return jsonResponse({ locations: [{ name: 'locations/777', title: '別の店' }] });
      return jsonResponse({}, 404);
    };
    const start = await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {} });
    expect(((await start.json()) as { mode: string }).mode).toBe('reconnect');
    const response = await startAndCallback((state) => `state=${state}&code=c`);
    expect(new URL(response.headers.get('location')!).searchParams.get('google')).toBe('error:location_mismatch');
    const row = testDb.raw.prepare('SELECT location_name, google_account_email, refresh_token_enc FROM rt_google_connections').get() as Record<string, string>;
    expect(row.location_name).toBe(LOCATION);
    expect(row.google_account_email).toBe('owner@example.test');
    expect(await decryptCredential(row.refresh_token_enc, ENC_KEY)).toBe('refresh-secret');
  });

  it('接続解除は確認が必須。トークンは消し、口コミの履歴は残す', async () => {
    seedStore();
    await seedConnection();
    testDb.raw.prepare(`INSERT INTO rt_google_reviews (id, store_id, review_name, star_rating, create_time) VALUES ('rv-1', 'store-shibuya', ?, 5, '2026-09-01T00:00:00Z')`).run(`${LOCATION}/reviews/r1`);
    googleHandler = () => jsonResponse({});
    const unconfirmed = await call('/api/restaurant-test/google/disconnect?account_id=account-2', { body: {} });
    expect(unconfirmed.status).toBe(400);
    const response = await call('/api/restaurant-test/google/disconnect?account_id=account-2', { body: { confirmed: true } });
    expect(response.status).toBe(200);
    expect(googleCalls[0].url).toBe('https://oauth2.googleapis.com/revoke');
    const row = testDb.raw.prepare('SELECT status, refresh_token_enc, access_token_enc, location_name FROM rt_google_connections').get();
    expect(row).toEqual({ status: 'disconnected', refresh_token_enc: null, access_token_enc: null, location_name: LOCATION });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_reviews').get()).toEqual({ n: 1 });
  });

  it('別テナントの範囲外 LINE アカウントは 403', async () => {
    seedStore();
    authMocks.lineAccounts = authMocks.lineAccounts.filter((account) => account.id !== 'account-2');
    const response = await call('/api/restaurant-test/google/connection?account_id=account-2');
    expect(response.status).toBe(403);
  });
});

describe('Googleビジネス：口コミ', () => {
  it('同期は最後のページまで取得し、2回目でも件数が増えない。★3以下は要確認', async () => {
    seedStore();
    await seedConnection();
    googleHandler = (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/reviews')) {
        if (parsed.searchParams.get('pageToken') === 'p2') return jsonResponse({ reviews: [{ name: `${LOCATION}/reviews/r4`, reviewId: 'r4', starRating: 'ONE', comment: 'x', createTime: '2026-09-20T00:00:00Z' }], averageRating: 4.6, totalReviewCount: 4 });
        return jsonResponse({ ...reviewPage, totalReviewCount: 4, nextPageToken: 'p2' });
      }
      return jsonResponse({}, 404);
    };
    const first = await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {} });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ fetched: 4, complete: true, averageRating: 4.6, totalReviewCount: 4 });
    expect(googleCalls.every((call) => (call.init?.headers as Record<string, string>).authorization === 'Bearer access-secret')).toBe(true);
    const second = await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {} });
    expect(second.status).toBe(200);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_reviews').get()).toEqual({ n: 4 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_reviews WHERE needs_attention = 1').get()).toEqual({ n: 2 });
    expect(testDb.raw.prepare(`SELECT reply_status FROM rt_google_reviews WHERE review_name = ?`).get(`${LOCATION}/reviews/r3`)).toEqual({ reply_status: 'published' });
    expect(testDb.raw.prepare('SELECT average_rating, total_review_count FROM rt_google_connections').get()).toEqual({ average_rating: 4.6, total_review_count: 4 });
  });

  it('同期：期限切れのアクセストークンは更新してから使い、invalid_grant なら認可切れにする', async () => {
    seedStore();
    await seedConnection({ expires: '2000-01-01T00:00:00.000Z' });
    googleHandler = (url) => (url === 'https://oauth2.googleapis.com/token' ? jsonResponse({ error: 'invalid_grant' }, 400) : jsonResponse({}, 500));
    const response = await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {} });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'auth_expired' });
    expect(testDb.raw.prepare('SELECT status FROM rt_google_connections').get()).toEqual({ status: 'expired' });
  });

  it('同期：429 が続いても前回の口コミを消さない', async () => {
    seedStore();
    await seedConnection();
    testDb.raw.prepare(`INSERT INTO rt_google_reviews (id, store_id, review_name, star_rating, create_time) VALUES ('rv-1', 'store-shibuya', ?, 5, '2026-09-01T00:00:00Z')`).run(`${LOCATION}/reviews/r1`);
    googleHandler = () => jsonResponse({}, 429);
    const response = await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {} });
    expect(response.status).toBe(503);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_reviews').get()).toEqual({ n: 1 });
    expect(testDb.raw.prepare('SELECT status, last_sync_error FROM rt_google_connections').get()).toEqual({ status: 'connected', last_sync_error: 'rate_limited' });
  }, 20_000);

  async function seedReviews(): Promise<void> {
    seedStore();
    await seedConnection();
    googleHandler = (url) => (new URL(url).pathname.endsWith('/reviews') ? jsonResponse(reviewPage) : jsonResponse({}, 404));
    await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {} });
    googleCalls = [];
  }

  it('一覧：既定は未返信、絞り込みと検索が効く。別店舗のIDは404', async () => {
    await seedReviews();
    const unreplied = (await (await call('/api/restaurant-test/google/reviews?account_id=account-2')).json()) as { reviews: Array<{ reviewName: string }>; total: number };
    expect(unreplied.total).toBe(2);
    const all = (await (await call('/api/restaurant-test/google/reviews?account_id=account-2&filter=all&order=rating_low')).json()) as { reviews: Array<{ starRating: number }> };
    expect(all.reviews.map((r) => r.starRating)).toEqual([3, 4, 5]);
    const searched = (await (await call('/api/restaurant-test/google/reviews?account_id=account-2&filter=all&q=閉まって')).json()) as { total: number };
    expect(searched.total).toBe(1);
    const attention = (await (await call('/api/restaurant-test/google/reviews?account_id=account-2&filter=attention')).json()) as { total: number };
    expect(attention.total).toBe(1);
    const missing = await call('/api/restaurant-test/google/reviews/no-such?account_id=account-2');
    expect(missing.status).toBe(404);
  });

  function reviewIdOf(reviewId: string): string {
    return (testDb.raw.prepare('SELECT id FROM rt_google_reviews WHERE review_name = ?').get(`${LOCATION}/reviews/${reviewId}`) as { id: string }).id;
  }

  it('AI下書き：投稿者名を送らず、生成文を下書きとして保存する。staff も使える', async () => {
    await seedReviews();
    const run = vi.fn(async () => ({ response: 'お客様、このたびはご来店ありがとうございます。' }));
    env.AI = { run } as unknown as Ai;
    useStaffRole('staff');
    const response = await call(`/api/restaurant-test/google/reviews/${reviewIdOf('r1')}/draft/generate?account_id=account-2`, { body: { mode: 'shorter' }, token: 'staff-key' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ draft: 'お客様、このたびはご来店ありがとうございます。', aiGenerated: true, mode: 'shorter' });
    const payload = JSON.stringify(run.mock.calls[0]);
    expect(payload).toContain('季節の定食');
    expect(payload).not.toContain('Aki');
    expect(testDb.raw.prepare('SELECT reply_status, reply_draft_ai_generated FROM rt_google_reviews WHERE review_name = ?').get(`${LOCATION}/reviews/r1`)).toEqual({ reply_status: 'draft', reply_draft_ai_generated: 1 });
  });

  it('AI下書き：AI が無い環境は 503、返信済みの口コミは 409', async () => {
    await seedReviews();
    const unavailable = await call(`/api/restaurant-test/google/reviews/${reviewIdOf('r1')}/draft/generate?account_id=account-2`, { body: {} });
    expect(unavailable.status).toBe(503);
    env.AI = { run: vi.fn(async () => ({ response: 'x' })) } as unknown as Ai;
    const replied = await call(`/api/restaurant-test/google/reviews/${reviewIdOf('r3')}/draft/generate?account_id=account-2`, { body: {} });
    expect(replied.status).toBe(409);
  });

  it('下書き保存：空・4,097文字は 400。保存すると draft になる', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    expect((await call(`/api/restaurant-test/google/reviews/${id}/draft?account_id=account-2`, { method: 'PUT', body: { replyDraft: ' ' } })).status).toBe(400);
    expect((await call(`/api/restaurant-test/google/reviews/${id}/draft?account_id=account-2`, { method: 'PUT', body: { replyDraft: 'a'.repeat(4097) } })).status).toBe(400);
    const ok = await call(`/api/restaurant-test/google/reviews/${id}/draft?account_id=account-2`, { method: 'PUT', body: { replyDraft: 'ご不便をおかけしました。' } });
    expect(ok.status).toBe(200);
    expect(testDb.raw.prepare('SELECT reply_status, reply_draft, reply_draft_ai_generated FROM rt_google_reviews WHERE id = ?').get(id)).toEqual({ reply_status: 'draft', reply_draft: 'ご不便をおかけしました。', reply_draft_ai_generated: 0 });
  });

  it('返信公開：確認フラグ必須、書き込み無効の環境は 403 で Google を呼ばない', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    expect((await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { comment: 'x' } })).status).toBe(400);
    env.GOOGLE_BUSINESS_WRITE_ENABLED = 'false';
    const response = await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: 'ありがとうございます' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'write_disabled' });
    expect(googleCalls).toHaveLength(0);
  });

  it('返信公開：送信直前に照合し、Google側に返信が無ければ PUT して replied にする', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    googleHandler = (url, init) => {
      if (url.endsWith('/reviews/r2/reply') && init?.method === 'PUT') return jsonResponse({ comment: 'ご指摘ありがとうございます', updateTime: '2026-09-23T03:00:00Z' });
      if (url.endsWith('/reviews/r2')) return jsonResponse({ name: `${LOCATION}/reviews/r2`, reviewId: 'r2', starRating: 'THREE', comment: '営業中なのに閉まっていた', createTime: '2026-09-22T01:00:00Z' });
      return jsonResponse({}, 404);
    };
    const response = await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: 'ご指摘ありがとうございます' } });
    expect(response.status).toBe(200);
    expect(googleCalls.map((c) => c.init?.method ?? 'GET')).toEqual(['GET', 'PUT']);
    expect(testDb.raw.prepare('SELECT reply_status, reply_comment FROM rt_google_reviews WHERE id = ?').get(id)).toEqual({ reply_status: 'replied', reply_comment: 'ご指摘ありがとうございます' });
    expect(testDb.raw.prepare('SELECT kind, result, after_text FROM rt_google_write_log').get()).toEqual({ kind: 'review_reply', result: 'accepted', after_text: 'ご指摘ありがとうございます' });
  });

  it('返信公開：別の担当者が先に返信していたら 409 で止め、相手の返信文を返す', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    googleHandler = (url) => (url.endsWith('/reviews/r2') ? jsonResponse({ name: `${LOCATION}/reviews/r2`, reviewId: 'r2', starRating: 'THREE', createTime: '2026-09-22T01:00:00Z', reviewReply: { comment: '先に返信しました' } }) : jsonResponse({}, 404));
    const response = await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: '別の返信' } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'already_replied', existingReply: '先に返信しました' });
    expect(googleCalls.some((c) => c.init?.method === 'PUT')).toBe(false);
    expect(testDb.raw.prepare('SELECT reply_status FROM rt_google_reviews WHERE id = ?').get(id)).toEqual({ reply_status: 'published' });
  });

  it('返信公開：通信結果が不明なら pending_confirm のまま残し、記録は unknown にする', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    googleHandler = (url, init) => {
      if (init?.method === 'PUT') throw new Error('socket hang up');
      if (url.endsWith('/reviews/r2')) return jsonResponse({ name: `${LOCATION}/reviews/r2`, reviewId: 'r2', starRating: 'THREE', createTime: '2026-09-22T01:00:00Z' });
      return jsonResponse({}, 404);
    };
    const response = await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: '返信' } });
    expect(response.status).toBe(502);
    expect(testDb.raw.prepare('SELECT reply_status FROM rt_google_reviews WHERE id = ?').get(id)).toEqual({ reply_status: 'pending_confirm' });
    expect(testDb.raw.prepare('SELECT result FROM rt_google_write_log').get()).toEqual({ result: 'unknown' });
  }, 20_000);

  it('権限：staff は公開・接続・解除ができず、全店担当の統括管理者は接続できる', async () => {
    await seedReviews();
    const id = reviewIdOf('r2');
    useStaffRole('staff');
    expect((await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: 'x' }, token: 'staff-key' })).status).toBe(403);
    expect((await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {}, token: 'staff-key' })).status).toBe(403);
    expect((await call('/api/restaurant-test/google/disconnect?account_id=account-2', { body: { confirmed: true }, token: 'staff-key' })).status).toBe(403);
    expect((await call('/api/restaurant-test/google/reviews?account_id=account-2', { token: 'staff-key' })).status).toBe(200);
    expect((await call('/api/restaurant-test/google/reviews/sync?account_id=account-2', { body: {}, token: 'staff-key' })).status).toBe(200);
    useStaffRole('admin');
    env.GOOGLE_BUSINESS_WRITE_ENABLED = 'false';
    expect((await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: 'x' }, token: 'admin-key' })).status).toBe(403);
    expect(await (await call(`/api/restaurant-test/google/reviews/${id}/reply?account_id=account-2`, { body: { confirmed: true, comment: 'x' }, token: 'admin-key' })).json()).toMatchObject({ code: 'write_disabled' });
    expect((await call('/api/restaurant-test/google/connect/start?account_id=account-2', { body: {}, token: 'admin-key' })).status).toBe(200);
  });
});
