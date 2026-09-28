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
const { restaurantGooglePosts } = await import('./restaurant-google-posts.js');
const { encryptCredential } = await import('@line-crm/db');
type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
const LOCATION = 'accounts/111/locations/222';
const ENC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** 2026-09-23（水）12:00 JST。 */
const NOW = new Date('2026-09-23T03:00:00.000Z');

let testDb: SqliteD1;
let env: Env['Bindings'];
let googleCalls: Array<{ url: string; init?: RequestInit }>;
let googlePostsOnGoogle: Array<Record<string, unknown>>;
let createFailStatus: number | null;
let logSpy: ReturnType<typeof vi.spyOn>;
let createSeq = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

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

async function seedConnection(): Promise<void> {
  testDb.raw
    .prepare(
      `INSERT INTO rt_google_connections
        (id, store_id, line_account_id, google_account_email, location_name, location_title, refresh_token_enc, access_token_enc, access_token_expires_at, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('conn-1', 'store-shibuya', 'account-2', 'owner@example.test', LOCATION, 'こもれび食堂 渋谷店', await encryptCredential('refresh-secret', ENC_KEY), await encryptCredential('access-secret', ENC_KEY), '2099-01-01T00:00:00.000Z', 'connected', '2026-09-23T00:00:00.000Z');
}

function seedMedia(id: string, filename: string, lineAccountId: string): void {
  testDb.raw
    .prepare(`INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, line_account_id) VALUES (?, 'image', ?, 'image/jpeg', 1000, ?, ?)`)
    .run(id, filename, `images/${filename}`, lineAccountId);
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantGooglePosts);
  return instance;
}

function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token ?? 'owner-key'}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return app().request(`${path}${path.includes('?') ? '&' : '?'}account_id=account-2`, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, env);
}

function useStaffRole(role: 'admin' | 'staff'): void {
  testDb.raw
    .prepare(`INSERT OR REPLACE INTO staff_members (id, name, role, api_key, tenant_id, account_scope, can_access_descendant_accounts, is_active) VALUES (?, ?, ?, ?, ?, 'all', 1, 1)`)
    .run(`${role}-1`, role, role, `${role}-key`, TENANT);
  authMocks.getStaffByApiKey.mockResolvedValue({ id: `${role}-1`, name: role, role, access_level: 'full', permission_keys: '[]', assigned_line_account_id: null, can_access_descendant_accounts: 1 });
}

function createCalls() {
  return googleCalls.filter((x) => x.url.endsWith('/localPosts') && x.init?.method === 'POST');
}

const standardBody = { kind: 'standard', summary: '秋のおすすめ定食がはじまります。', mediaId: null };

async function createDraft(body: Record<string, unknown> = standardBody, token?: string) {
  const res = await call('/api/restaurant-test/google/posts', { body, token });
  return { status: res.status, json: (await res.json()) as { success: boolean; post?: { id: string; status: string } } };
}

async function publish(id: string, token?: string, confirmed = true) {
  const res = await call(`/api/restaurant-test/google/posts/${id}/publish`, { body: { confirmed }, token });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { post?: { id: string; status: string; googleState: string | null } } };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.getStaffByAdminSession.mockReset();
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '渋谷店', is_active: 1, channel_access_token: 'token-2' },
  ];
  testDb = createTestD1();
  googleCalls = [];
  googlePostsOnGoogle = [];
  createFailStatus = null;
  createSeq = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      googleCalls.push({ url, init });
      if (url.endsWith('/localPosts') && init?.method === 'POST') {
        if (createFailStatus) return jsonResponse({ error: { message: 'fail' } }, createFailStatus);
        createSeq += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const created = { name: `${LOCATION}/localPosts/p${createSeq}`, ...body, state: 'LIVE', createTime: new Date().toISOString(), searchUrl: `https://g.page/p${createSeq}` };
        googlePostsOnGoogle.push(created);
        return jsonResponse(created);
      }
      if (url.includes('/localPosts') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ localPosts: googlePostsOnGoogle });
      }
      if (url.includes('/localPosts/') && init?.method === 'DELETE') {
        const name = url.replace('https://mybusiness.googleapis.com/v4/', '');
        googlePostsOnGoogle = googlePostsOnGoogle.filter((p) => p.name !== name);
        return new Response('{}', { status: 200 });
      }
      return jsonResponse({}, 404);
    }),
  );
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    AI: { run: vi.fn(async () => ({ response: '' })) } as unknown as Ai,
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
  seedStore();
  await seedConnection();
});

afterEach(() => {
  vi.useRealTimers();
  logSpy.mockRestore();
});

describe('下書き（GB-4/5/6/7）', () => {
  it('下書き作成はGoogleへ通信しない', async () => {
    const r = await createDraft();
    expect(r.status).toBe(200);
    expect(r.json.post).toMatchObject({ status: 'draft' });
    expect(googleCalls).toHaveLength(0);
  });

  it('GB-8：登録メディアの画像だけを選べる（他アカウントの画像は404）', async () => {
    seedMedia('media-1', 'gaikan.jpg', 'account-2');
    seedMedia('media-other', 'other.jpg', 'account-1');
    const other = await createDraft({ ...standardBody, mediaId: 'media-other' });
    expect(other.status).toBe(404);
    const ok = await createDraft({ ...standardBody, mediaId: 'media-1' });
    expect(ok.status).toBe(200);
    const get = await call(`/api/restaurant-test/google/posts/${ok.json.post!.id}`);
    const body = (await get.json()) as { post: { media: Array<{ sourceUrl: string }> } };
    expect(body.post.media).toEqual([{ mediaId: 'media-1', filename: 'gaikan.jpg', sourceUrl: 'https://worker.example.test/images/images/gaikan.jpg' }]);
  });
});

describe('権限', () => {
  it('担当者は下書きを作れるが公開はできない。店舗管理者以上は公開できる', async () => {
    useStaffRole('staff');
    const draft = await createDraft(standardBody, 'staff-key');
    expect(draft.status).toBe(200);
    const staffPublish = await publish(draft.json.post!.id, 'staff-key');
    expect(staffPublish.status).toBe(403);

    useStaffRole('admin');
    const p = await publish(draft.json.post!.id, 'admin-key');
    expect(p.status).toBe(200);
  });
});

describe('書き込みガード', () => {
  it('GOOGLE_BUSINESS_WRITE_ENABLED が有効でなければ403、Googleへは接続しない', async () => {
    env.GOOGLE_BUSINESS_WRITE_ENABLED = 'false';
    const draft = await createDraft();
    const r = await publish(draft.json.post!.id);
    expect(r.status).toBe(403);
    expect((r.json as { code?: string }).code).toBe('write_disabled');
    expect(createCalls()).toHaveLength(0);
  });

  it('confirmed:false は write_disabled より先に400', async () => {
    env.GOOGLE_BUSINESS_WRITE_ENABLED = 'false';
    const draft = await createDraft();
    const r = await publish(draft.json.post!.id, undefined, false);
    expect(r.status).toBe(400);
    expect((r.json as { code?: string }).code).toBe('confirmation_required');
  });
});

describe('公開（GB-14）', () => {
  it('成功時はlocalPostsへのPOSTが1回、状態がpublishedになる', async () => {
    const draft = await createDraft();
    const r = await publish(draft.json.post!.id);
    expect(r.status).toBe(200);
    expect(createCalls()).toHaveLength(1);
    expect(JSON.parse(String(createCalls()[0].init?.body))).toMatchObject({ topicType: 'STANDARD', summary: standardBody.summary });
    expect(r.json.post).toMatchObject({ status: 'published', googleState: 'LIVE' });
  });

  it('予約投稿(publish_mode=scheduled)は受け付けない', async () => {
    const draft = await createDraft();
    testDb.raw.prepare(`UPDATE rt_google_posts SET publish_mode = 'scheduled' WHERE id = ?`).run(draft.json.post!.id);
    const r = await publish(draft.json.post!.id);
    expect(r.status).toBe(400);
    expect((r.json as { code?: string }).code).toBe('not_supported');
  });

  it('二重投稿しない：送信結果不明のあとGoogle側に実際は届いていた場合、次の確認で作成し直さない', async () => {
    const draft = await createDraft();
    createFailStatus = 500;
    const first = await publish(draft.json.post!.id);
    expect(first.status).toBe(502);
    expect(createCalls()).toHaveLength(1);

    // Googleには実際は届いていた（結果不明だっただけ）ことを模擬する。
    createFailStatus = null;
    const row = testDb.raw.prepare('SELECT content_fingerprint, sent_at FROM rt_google_posts WHERE id = ?').get(draft.json.post!.id) as { content_fingerprint: string; sent_at: string };
    googlePostsOnGoogle.push({ name: `${LOCATION}/localPosts/silent1`, topicType: 'STANDARD', summary: standardBody.summary, state: 'LIVE', createTime: new Date(Date.parse(row.sent_at) + 1000).toISOString(), searchUrl: 'https://g.page/silent1' });

    const second = await publish(draft.json.post!.id);
    expect(second.status).toBe(200);
    expect(second.json.alreadyPublished).toBe(true);
    expect(second.json.post).toMatchObject({ status: 'published' });
    expect(createCalls()).toHaveLength(1); // 2回目はPOSTしていない
  });

  it('別内容の投稿は、他の送信結果不明な投稿と取り違えない', async () => {
    const draftA = await createDraft({ kind: 'standard', summary: 'Aの本文です', mediaId: null });
    const draftB = await createDraft({ kind: 'standard', summary: 'Bの本文です', mediaId: null });
    createFailStatus = 500;
    await publish(draftA.json.post!.id);
    await publish(draftB.json.post!.id);
    expect(createCalls()).toHaveLength(2);

    createFailStatus = null;
    const rowA = testDb.raw.prepare('SELECT content_fingerprint, sent_at FROM rt_google_posts WHERE id = ?').get(draftA.json.post!.id) as { content_fingerprint: string; sent_at: string };
    const rowB = testDb.raw.prepare('SELECT content_fingerprint, sent_at FROM rt_google_posts WHERE id = ?').get(draftB.json.post!.id) as { content_fingerprint: string; sent_at: string };
    googlePostsOnGoogle.push({ name: `${LOCATION}/localPosts/silentA`, topicType: 'STANDARD', summary: 'Aの本文です', state: 'LIVE', createTime: new Date(Date.parse(rowA.sent_at) + 1000).toISOString() });
    googlePostsOnGoogle.push({ name: `${LOCATION}/localPosts/silentB`, topicType: 'STANDARD', summary: 'Bの本文です', state: 'LIVE', createTime: new Date(Date.parse(rowB.sent_at) + 1000).toISOString() });

    const againA = await publish(draftA.json.post!.id);
    const againB = await publish(draftB.json.post!.id);
    expect(againA.json.post).toMatchObject({ status: 'published' });
    expect(againB.json.post).toMatchObject({ status: 'published' });
    const postedNameOf = (id: string) => (testDb.raw.prepare('SELECT google_post_name FROM rt_google_posts WHERE id = ?').get(id) as { google_post_name: string }).google_post_name;
    expect(postedNameOf(draftA.json.post!.id)).toBe(`${LOCATION}/localPosts/silentA`);
    expect(postedNameOf(draftB.json.post!.id)).toBe(`${LOCATION}/localPosts/silentB`);
    expect(createCalls()).toHaveLength(2); // 追加のPOSTは発生していない
  });

  it('OFFERはevent(title+schedule)を送り、callToActionは送らない', async () => {
    const draft = await createDraft({
      kind: 'offer',
      summary: '週末のディナーで使える、お会計10%OFFの特典です。',
      title: '週末のディナーを、少しお得に',
      schedule: { startDate: '2026-10-01', startTime: '17:00', endDate: '2026-10-02', endTime: '22:00' },
      offer: { couponCode: 'AUTUMN10' },
      mediaId: null,
    });
    const r = await publish(draft.json.post!.id);
    expect(r.status).toBe(200);
    const body = JSON.parse(String(createCalls()[0].init?.body));
    expect(body.topicType).toBe('OFFER');
    expect(body.event).toMatchObject({ title: '週末のディナーを、少しお得に' });
    expect(body.callToAction).toBeUndefined();
    expect(body.offer).toMatchObject({ couponCode: 'AUTUMN10' });
  });

  it('応答に暗号化前の秘密値が含まれない', async () => {
    const draft = await createDraft();
    const r = await publish(draft.json.post!.id);
    expect(JSON.stringify(r.json)).not.toContain('refresh-secret');
    expect(JSON.stringify(r.json)).not.toContain('access-secret');
  });
});

describe('取り込み（sync）', () => {
  it('REJECTEDはrejectedとしてattentionに数え、消えた公開済みはdeletedになる', async () => {
    const deletedDraft = await createDraft({ kind: 'standard', summary: '公開済みだった投稿', mediaId: null });
    await publish(deletedDraft.json.post!.id);
    const rejectedDraft = await createDraft({ kind: 'standard', summary: '不承認になった投稿', mediaId: null });
    await publish(rejectedDraft.json.post!.id);

    // 「公開済みだった投稿」はGoogle側からもう無い（誰かが消した）。「不承認になった投稿」はGoogleの審査でREJECTEDに変わった。
    // 「Googleで直接作った投稿」は社内管理画面を経由していない（Google側で直接作られた）。
    googlePostsOnGoogle = googlePostsOnGoogle
      .filter((p) => p.name !== `${LOCATION}/localPosts/p1`)
      .map((p) => (p.name === `${LOCATION}/localPosts/p2` ? { ...p, state: 'REJECTED' } : p));
    googlePostsOnGoogle.push({ name: `${LOCATION}/localPosts/fromgoogle1`, topicType: 'STANDARD', summary: 'Googleで直接作った投稿', state: 'LIVE', createTime: NOW.toISOString() });
    const s = await call('/api/restaurant-test/google/posts/sync', { method: 'POST' });
    expect(s.status).toBe(200);

    const list = await call('/api/restaurant-test/google/posts');
    const body = (await list.json()) as { posts: Array<{ status: string; origin: string; summary: string }>; counts: Record<string, number> };
    const original = body.posts.find((p) => p.summary === '公開済みだった投稿');
    expect(original?.status).toBe('deleted');
    const rejected = body.posts.find((p) => p.summary === '不承認になった投稿');
    expect(rejected).toMatchObject({ status: 'rejected', origin: 'admin' });
    const fromGoogle = body.posts.find((p) => p.summary === 'Googleで直接作った投稿');
    expect(fromGoogle).toMatchObject({ status: 'published', origin: 'google' });
    expect(body.counts.attention).toBe(1);
  });
});

describe('削除', () => {
  it('公開済みを削除するとGoogleへDELETEし、statusがdeletedになる', async () => {
    const draft = await createDraft();
    await publish(draft.json.post!.id);
    const r = await call(`/api/restaurant-test/google/posts/${draft.json.post!.id}/remove`, { body: { confirmed: true } });
    expect(r.status).toBe(200);
    expect(googleCalls.some((x) => x.init?.method === 'DELETE')).toBe(true);
    const body = (await r.json()) as { post: { status: string } };
    expect(body.post.status).toBe('deleted');
  });
});
