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
const { restaurantGoogle } = await import('./restaurant-google.js');
const { restaurantGoogleProfile } = await import('./restaurant-google-profile.js');
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
let location: Record<string, unknown>;
let aiResponse: string;
let logSpy: ReturnType<typeof vi.spyOn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const p = (openDay: string, o: number, c: number, closeDay = openDay) => ({ openDay, openTime: { hours: o }, closeDay, closeTime: { hours: c } });

function baseLocation(): Record<string, unknown> {
  const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  return {
    name: 'locations/222',
    title: 'こもれび食堂 渋谷店',
    storefrontAddress: { postalCode: '150-0001', administrativeArea: '東京都', locality: '渋谷区', addressLines: ['神宮前1-2-3'] },
    phoneNumbers: { primaryPhone: '03-1234-5678' },
    websiteUri: 'https://example.jp',
    profile: { description: '季節の定食' },
    openInfo: { status: 'OPEN' },
    regularHours: { periods: days.flatMap((d) => [p(d, 11, 15), p(d, 17, 22)]) },
    specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 10, day: 1 }, endDate: { year: 2026, month: 10, day: 1 }, closed: true }] },
    metadata: { mapsUri: 'https://maps.google.com/?cid=1' },
  };
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

function seedReservation(id: string, startsAtUtc: string, status = 'confirmed'): void {
  testDb.raw
    .prepare(`INSERT INTO rt_reservations (id, store_id, source, customer_name, guest_count, starts_at, ends_at, status) VALUES (?, ?, 'manual', ?, 2, ?, ?, ?)`)
    .run(id, 'store-shibuya', '予約者', startsAtUtc, startsAtUtc, status);
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantGoogle);
  instance.route('/', restaurantGoogleProfile);
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

function patchCalls() {
  return googleCalls.filter((x) => x.init?.method === 'PATCH');
}

async function propose(body: unknown, token?: string) {
  const res = await call('/api/restaurant-test/google/hours/propose', { body, token });
  return { status: res.status, json: (await res.json()) as { success: boolean; change?: { id: string; kind: string; summary: string; before: unknown; after: unknown; reservationImpactCount: number; status: string }; question?: string; error?: string; code?: string } };
}

async function send(id: string, token?: string, confirmed = true) {
  const res = await call(`/api/restaurant-test/google/changes/${id}/send`, { body: { confirmed }, token });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { change?: { status: string } } };
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
  location = baseLocation();
  aiResponse = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      googleCalls.push({ url, init });
      if (url.includes('/v1/locations/222')) {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          location = { ...location, ...body };
        }
        return jsonResponse(location);
      }
      if (url.includes('/media') && init?.method === 'POST') return jsonResponse({ name: `${LOCATION}/media/m9`, googleUrl: 'https://lh3.example/m9' });
      if (url.includes('/media') && init?.method === 'DELETE') return new Response('{}', { status: 200 });
      if (url.includes('/media')) return jsonResponse({ mediaItems: [{ name: `${LOCATION}/media/m1`, googleUrl: 'https://lh3.example/m1', thumbnailUrl: 'https://lh3.example/m1=s200' }] });
      return jsonResponse({}, 404);
    }),
  );
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    AI: { run: vi.fn(async () => ({ response: aiResponse })) } as unknown as Ai,
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

describe('Googleビジネス：プロフィール（GB-10）', () => {
  it('locations.get を readMask 付きで1回だけ呼び、今日の営業時間・祝日・写しを返す', async () => {
    const res = await call('/api/restaurant-test/google/profile');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(googleCalls.filter((x) => x.url.includes('/v1/locations/222?readMask='))).toHaveLength(1);
    expect(body.profile.title).toBe('こもれび食堂 渋谷店');
    expect(body.today).toMatchObject({ date: '2026-09-23', weekday: 'WEDNESDAY', holidayName: '秋分の日', closed: false, special: false });
    expect(body.today.periods).toEqual([{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }]);
    expect(body.profile.specialHours).toEqual([{ date: '2026-10-01', closed: true, periods: [] }]);
    expect(body.holidays.map((h: { date: string }) => h.date)).toEqual(['2026-09-23', '2026-10-12']);
    expect(body.permissions.canSendChange).toBe(true);

    googleCalls = [];
    const again = await call('/api/restaurant-test/google/profile');
    expect(again.status).toBe(200);
    expect(googleCalls).toHaveLength(0); // 10分以内は写しを使う
  });

  it('Google側が臨時休業なら変更案を作れない（409 store_closed）', async () => {
    location.openInfo = { status: 'CLOSED_TEMPORARILY' };
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('store_closed');
  });
});

describe('Googleビジネス：営業時間の変更案（GB-11）', () => {
  it('「今日を休みにする」は今日の特別営業時間＝休業の案を作り、予約への影響は件数だけ返す', async () => {
    seedReservation('rsv-1', '2026-09-23T10:00:00.000Z'); // 19:00 JST 当日
    seedReservation('rsv-2', '2026-09-23T10:30:00.000Z', 'cancelled'); // 数えない
    seedReservation('rsv-3', '2026-09-24T10:00:00.000Z'); // 翌日は対象外
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    expect(r.status).toBe(200);
    expect(r.json.change).toMatchObject({ kind: 'special_hours', summary: '9/23（水）を休業に', status: 'draft', reservationImpactCount: 1 });
    expect(r.json.change!.before).toEqual([{ date: '2026-09-23', closed: false, periods: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }] }]);
    expect(r.json.change!.after).toEqual([{ date: '2026-09-23', closed: true, periods: [] }]);
    expect(JSON.stringify(r.json)).not.toContain('予約者');
  });

  it('「今日は早く閉める」は最後の枠の終了だけを置き換える', async () => {
    seedReservation('rsv-1', '2026-09-23T12:00:00.000Z'); // 21:00 JST → 20:00 閉店なら影響
    seedReservation('rsv-2', '2026-09-23T09:00:00.000Z'); // 18:00 JST → 影響なし
    const r = await propose({ source: 'shortcut', shortcut: 'early_close_today', closeTime: '20:00' });
    expect(r.status).toBe(200);
    expect(r.json.change!.after).toEqual([{ date: '2026-09-23', closed: false, periods: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '20:00' }] }]);
    expect(r.json.change!.reservationImpactCount).toBe(1);
    const bad = await propose({ source: 'shortcut', shortcut: 'early_close_today', closeTime: '16:00' });
    expect(bad.status).toBe(400);
  });

  it('カレンダー指定：過去日は 400、同じ内容なら 409 unchanged', async () => {
    const past = await propose({ source: 'calendar', days: [{ date: '2026-09-22', closed: true, periods: [] }] });
    expect(past.status).toBe(400);
    const same = await propose({ source: 'calendar', days: [{ date: '2026-10-01', closed: true, periods: [] }] });
    expect(same.status).toBe(409);
    expect(same.json.code).toBe('unchanged');
    const ok = await propose({ source: 'calendar', days: [{ date: '2026-09-25', closed: false, periods: [{ open: '09:00', close: '17:00' }] }] });
    expect(ok.status).toBe(200);
    expect(ok.json.change!.summary).toBe('9/25（金）を09:00–17:00に');
  });

  it('毎週：変わった曜日だけを対象にし、深夜またぎも受け付ける', async () => {
    const weekly = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((d) => [d, [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }]]));
    weekly.FRIDAY = [{ open: '11:00', close: '15:00' }, { open: '18:00', close: '02:00' }];
    weekly.SUNDAY = [];
    const r = await propose({ source: 'weekly', weekly });
    expect(r.status).toBe(200);
    expect(r.json.change).toMatchObject({ kind: 'regular_hours', summary: '毎週 金曜を11:00–15:00 / 18:00–02:00に' });
    expect(r.json.change!.before).toEqual({ FRIDAY: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }] });
  });

  it('かんたん入力：AIのJSONを検証して案にする。質問・不正な日付は question で止まる', async () => {
    aiResponse = '{"kind":"special","dates":["2026-09-25"],"closed":false,"periods":[{"open":"09:00","close":"17:00"}]}';
    const r = await propose({ source: 'text', text: '今週の金曜日は9:00から17:00オープンにして' });
    expect(r.status).toBe(200);
    expect(r.json.change).toMatchObject({ kind: 'special_hours', summary: '9/25（金）を09:00–17:00に' });
    const aiCall = (env.AI as unknown as { run: ReturnType<typeof vi.fn> }).run.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(aiCall.messages[0].content).toContain('基準日は 2026-09-23');
    expect(aiCall.messages[0].content).not.toContain('予約者');

    aiResponse = '{"kind":"question","question":"どの金曜日ですか？"}';
    const q = await propose({ source: 'text', text: '金曜は休み' });
    expect(q.status).toBe(200);
    expect(q.json.question).toBe('どの金曜日ですか？');
    expect(q.json.change).toBeUndefined();

    aiResponse = '{"kind":"special","dates":["2026-09-22"],"closed":true}';
    const past = await propose({ source: 'text', text: '昨日は休み' });
    expect(past.json.question).toContain('過去の日付');

    aiResponse = 'わかりません';
    const junk = await propose({ source: 'text', text: 'こんにちは' });
    expect(junk.json.question).toBeTruthy();
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_changes').get()).toEqual({ n: 1 });
  });
});

describe('Googleビジネス：変更の送信（GB-12 / GB-15）', () => {
  it('送信は最新の全リストへ対象日を差し替えて specialHours を全体送信し、反映が確認できたら applied', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    const unconfirmed = await send(r.json.change!.id, undefined, false);
    expect(unconfirmed.status).toBe(400);
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(200);
    expect(s.json.alreadyApplied).toBe(false);
    expect(s.json.change!.status).toBe('applied');
    const patch = patchCalls();
    expect(patch).toHaveLength(1);
    expect(patch[0].url).toContain('updateMask=specialHours');
    const body = JSON.parse(String(patch[0].init?.body)) as { specialHours: { specialHourPeriods: Array<{ startDate: { day: number }; closed?: boolean }> } };
    expect(body.specialHours.specialHourPeriods.map((x) => x.startDate.day)).toEqual([23, 1]);
    expect(body.specialHours.specialHourPeriods.every((x) => x.closed)).toBe(true);
    const audit = logSpy.mock.calls.map((args) => String(args[0])).filter((line) => line.includes('"tag":"audit"') && line.includes('restaurant.google.change.send'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).not.toContain('access-secret');
  });

  it('毎週の送信は7曜日すべてを regularHours に含め、対象曜日だけ変わっている', async () => {
    const weekly = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((d) => [d, [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '22:00' }]]));
    weekly.FRIDAY = [{ open: '11:00', close: '23:00' }];
    weekly.SUNDAY = [];
    const r = await propose({ source: 'weekly', weekly });
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(200);
    const body = JSON.parse(String(patchCalls()[0].init?.body)) as { regularHours: { periods: Array<{ openDay: string; closeTime: { hours: number } }> } };
    expect(patchCalls()[0].url).toContain('updateMask=regularHours');
    expect(body.regularHours.periods.filter((x) => x.openDay === 'FRIDAY')).toEqual([{ openDay: 'FRIDAY', openTime: { hours: 11, minutes: 0 }, closeDay: 'FRIDAY', closeTime: { hours: 23, minutes: 0 } }]);
    expect(body.regularHours.periods.filter((x) => x.openDay === 'MONDAY')).toHaveLength(2);
    expect(body.regularHours.periods).toHaveLength(11);
  });

  it('別の担当者が先に変えていたら 409 conflict で送らない', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    location.regularHours = { periods: [p('WEDNESDAY', 10, 20)] }; // 送信前にGoogle側が変わった
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(409);
    expect(s.json.code).toBe('conflict');
    expect(s.json.current).toEqual([{ date: '2026-09-23', closed: false, periods: [{ open: '10:00', close: '20:00' }] }]);
    expect(patchCalls()).toHaveLength(0);
    expect(s.json.change!.status).toBe('conflict');
  });

  it('すでに変更後と同じなら送らずに applied にする', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    location.specialHours = { specialHourPeriods: [{ startDate: { year: 2026, month: 9, day: 23 }, endDate: { year: 2026, month: 9, day: 23 }, closed: true }] };
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(200);
    expect(s.json.alreadyApplied).toBe(true);
    expect(patchCalls()).toHaveLength(0);
  });

  it('書き込み無効の環境では 403 で patch を呼ばない', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    env.GOOGLE_BUSINESS_WRITE_ENABLED = 'false';
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(403);
    expect(s.json.code).toBe('write_disabled');
    expect(patchCalls()).toHaveLength(0);
  });

  it('通信結果が不明なら pending_confirm のまま残し、次回は照合して applied にできる', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') throw new TypeError('network down');
      return (original as typeof fetch)(url, init);
    }));
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(502);
    expect(testDb.raw.prepare('SELECT status FROM rt_google_changes WHERE id = ?').get(r.json.change!.id)).toEqual({ status: 'pending_confirm' });
    vi.stubGlobal('fetch', original);
    location.specialHours = { specialHourPeriods: [{ startDate: { year: 2026, month: 9, day: 23 }, endDate: { year: 2026, month: 9, day: 23 }, closed: true }] };
    const again = await send(r.json.change!.id);
    expect(again.status).toBe(200);
    expect(again.json.alreadyApplied).toBe(true);
  }, 20_000);

  it('Google が 400 を返したら failed にして内容は残す', async () => {
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' });
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse({ error: { message: 'Invalid hours' } }, 400);
      return (original as typeof fetch)(url, init);
    }));
    const s = await send(r.json.change!.id);
    expect(s.status).toBe(400);
    expect(s.json.error).toContain('Invalid hours');
    expect(s.json.change!.status).toBe('failed');
    const row = testDb.raw.prepare('SELECT after_json FROM rt_google_changes WHERE id = ?').get(r.json.change!.id) as { after_json: string };
    expect(JSON.parse(row.after_json)).toEqual([{ date: '2026-09-23', closed: true, periods: [] }]);
  });

  it('権限：担当者は閲覧・変更案まで、送信は 403。取り消しは draft だけ', async () => {
    useStaffRole('staff');
    expect((await call('/api/restaurant-test/google/profile', { token: 'staff-key' })).status).toBe(200);
    const r = await propose({ source: 'shortcut', shortcut: 'close_today' }, 'staff-key');
    expect(r.status).toBe(200);
    const s = await send(r.json.change!.id, 'staff-key');
    expect(s.status).toBe(403);
    expect(patchCalls()).toHaveLength(0);
    const cancel = await call(`/api/restaurant-test/google/changes/${r.json.change!.id}/cancel`, { body: {}, token: 'staff-key' });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { change: { status: string } }).change.status).toBe('cancelled');

    useStaffRole('admin');
    const r2 = await propose({ source: 'shortcut', shortcut: 'close_today' }, 'admin-key');
    const s2 = await send(r2.json.change!.id, 'admin-key');
    expect(s2.status).toBe(200);
    const cancel2 = await call(`/api/restaurant-test/google/changes/${r2.json.change!.id}/cancel`, { body: {}, token: 'admin-key' });
    expect(cancel2.status).toBe(409);
  });
});

describe('Googleビジネス：プロフィール項目・写真（GB-18 / GB-19）', () => {
  it('店舗紹介の変更は updateMask=profile.description で送る。変更なしは 409', async () => {
    const same = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'description', value: '季節の定食' } });
    expect(same.status).toBe(409);
    const res = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'description', value: '季節の定食と地酒' } });
    expect(res.status).toBe(200);
    const change = ((await res.json()) as { change: { id: string; summary: string; before: string; after: string } }).change;
    expect(change).toMatchObject({ summary: '店舗紹介を変更', before: '季節の定食', after: '季節の定食と地酒' });
    const s = await send(change.id);
    expect(s.status).toBe(200);
    expect(s.json.change!.status).toBe('applied');
    expect(patchCalls()[0].url).toContain('updateMask=profile.description');
    expect(JSON.parse(String(patchCalls()[0].init?.body))).toEqual({ profile: { description: '季節の定食と地酒' } });
  });

  it('入力検証：ウェブサイトは http(s) のみ、郵便番号は 123-4567、電話は数字とハイフン', async () => {
    const bad = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'websiteUri', value: 'javascript:alert(1)' } });
    expect(bad.status).toBe(400);
    const badZip = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'address', value: { postalCode: '150', administrativeArea: '東京都', locality: '渋谷区', addressLines: ['神宮前1-2-3'] } } });
    expect(badZip.status).toBe(400);
    const badPhone = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'phone', value: 'abc' } });
    expect(badPhone.status).toBe(400);
    const okAddr = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'address', value: { postalCode: '150-0002', administrativeArea: '東京都', locality: '渋谷区', addressLines: ['渋谷1-1-1', 'ビル2F'] } } });
    expect(okAddr.status).toBe(200);
    const change = ((await okAddr.json()) as { change: { id: string } }).change;
    await send(change.id);
    expect(patchCalls()[0].url).toContain('updateMask=storefrontAddress');
    expect(JSON.parse(String(patchCalls()[0].init?.body))).toMatchObject({ storefrontAddress: { regionCode: 'JP', postalCode: '150-0002', addressLines: ['渋谷1-1-1', 'ビル2F'] } });
  });

  it('写真：登録メディアの画像だけを追加でき、送信で media.create に公開URLを渡す。削除は自店舗の写真だけ', async () => {
    testDb.raw
      .prepare(`INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, line_account_id) VALUES (?, 'image', ?, 'image/jpeg', 1000, ?, ?)`)
      .run('media-1', 'gaikan.jpg', 'images/gaikan.jpg', 'account-2');
    testDb.raw
      .prepare(`INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, line_account_id) VALUES (?, 'image', ?, 'image/jpeg', 1000, ?, ?)`)
      .run('media-other', 'other.jpg', 'images/other.jpg', 'account-1');
    const other = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'photo', action: 'add', mediaId: 'media-other' } });
    expect(other.status).toBe(404);
    const res = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'photo', action: 'add', mediaId: 'media-1' } });
    expect(res.status).toBe(200);
    const change = ((await res.json()) as { change: { id: string; summary: string } }).change;
    expect(change.summary).toBe('写真を追加（gaikan.jpg）');
    const s = await send(change.id);
    expect(s.status).toBe(200);
    expect(s.json.change!.status).toBe('applied');
    const post = googleCalls.find((x) => x.url.endsWith('/media') && x.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ mediaFormat: 'PHOTO', sourceUrl: 'https://worker.example.test/images/images/gaikan.jpg' });

    const badDelete = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'photo', action: 'delete', mediaName: 'accounts/999/locations/1/media/x' } });
    expect(badDelete.status).toBe(400);
    const del = await call('/api/restaurant-test/google/profile/propose', { body: { field: 'photo', action: 'delete', mediaName: `${LOCATION}/media/m1` } });
    expect(del.status).toBe(200);
    const photos = await call('/api/restaurant-test/google/photos');
    expect(((await photos.json()) as { photos: Array<{ name: string }> }).photos[0].name).toBe(`${LOCATION}/media/m1`);
  });
});

describe('Googleビジネス：変更履歴（GB-17）', () => {
  it('案（draft）は履歴に出さず、送信・取り消し・失敗を新しい順に返す', async () => {
    const a = await propose({ source: 'shortcut', shortcut: 'close_today' });
    await send(a.json.change!.id);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const b = await propose({ source: 'calendar', days: [{ date: '2026-09-30', closed: true, periods: [] }] });
    await call(`/api/restaurant-test/google/changes/${b.json.change!.id}/cancel`, { body: {} });
    await propose({ source: 'calendar', days: [{ date: '2026-10-05', closed: true, periods: [] }] }); // draft のまま
    const res = await call('/api/restaurant-test/google/changes?limit=10');
    expect(res.status).toBe(200);
    const list = ((await res.json()) as { changes: Array<{ status: string; summary: string; staffName: string | null }> }).changes;
    expect(list.map((x) => x.status)).toEqual(['cancelled', 'applied']);
    expect(list[1]).toMatchObject({ summary: '9/23（水）を休業に' });
    const detail = await call(`/api/restaurant-test/google/changes/${a.json.change!.id}`);
    expect(((await detail.json()) as { change: { status: string }; canSend: boolean }).canSend).toBe(true);
  });
});
