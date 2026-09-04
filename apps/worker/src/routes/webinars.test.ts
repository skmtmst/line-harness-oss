import { Hono } from 'hono';
import type { Env } from '../index.js';
import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  getWebinars: vi.fn(),
  getWebinarById: vi.fn(),
  getWebinarBySlug: vi.fn(),
  createWebinar: vi.fn(),
  updateWebinar: vi.fn(),
  deleteWebinar: vi.fn(),
  getWebinarComments: vi.fn(),
  getWebinarCtas: vi.fn(),
  replaceWebinarCtas: vi.fn(),
  getFormById: vi.fn(),
  replaceWebinarComments: vi.fn(),
  upsertWebinarViewer: vi.fn(),
  updateWebinarViewerPosition: vi.fn(),
  recordWebinarCtaClick: vi.fn(),
  recordWebinarFunnelEvent: vi.fn(),
  insertWebinarUserComment: vi.fn(),
  countSessionUserComments: vi.fn(),
  getWebinarUserComments: vi.fn(),
  getWebinarSessionStats: vi.fn(),
  getWebinarDropoff: vi.fn(),
  getWebinarParticipantStats: vi.fn(),
  getWebinarAnalyticsSummary: vi.fn(),
  getWebinarDailyStats: vi.fn(),
  getWebinarFormFunnelStats: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  upsertWebinarRegistration: vi.fn(),
  getUpcomingWebinarRegistration: vi.fn(),
  getWebinarRegistration: vi.fn(),
  recordWebinarPickerOpen: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  getDueWebinarRegistrations: vi.fn(),
  markWebinarRegistrationNotified: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const authMock = { verifyCallerLineUserId: vi.fn() };
vi.mock('../services/liff-auth.js', () => authMock);

const tagMock = { attachTagAndFireSideEffects: vi.fn() };
vi.mock('../services/friend-tag-attach.js', () => tagMock);

const localProxyMock = { dispatchLineProxyLocally: vi.fn() };
vi.mock('../services/local-line-proxy.js', () => localProxyMock);

const webinarNotificationMocks = {
  enqueueWebinarCompletedNotification: vi.fn(),
  getWebinarNotificationOverview: vi.fn(),
  getWebinarNotificationSettings: vi.fn(),
  registerWebinarSession: vi.fn(),
  saveWebinarNotificationSettings: vi.fn(),
  sendWebinarNotificationTest: vi.fn(),
};
vi.mock('../services/webinar-notifications.js', () => webinarNotificationMocks);

const accountAccessMock = {
  canAccessAllLineAccounts: vi.fn(async (
    _db: D1Database, _staff: unknown, _ids: Array<string | null>,
  ) => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['account-a'], canSeeUnassigned: false,
  })),
};
vi.mock('../services/account-access.js', () => accountAccessMock);

const { webinarRoutes } = await import('./webinars.js');
const { signWebinarToken } = await import('../lib/webinar-token.js');

const SECRET = 'channel-secret';
// 2026-07-29 20:00 JST 開始の once スケジュール
const SESSION_START = Math.floor(Date.UTC(2026, 6, 29, 11, 0) / 1000);

function makeWebinar(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    account_id: null,
    title: 'テストウェビナー',
    slug: 'test-webinar',
    status: 'active',
    video_prefix: 'webinars/test-webinar',
    duration_seconds: 7200,
    schedule_json: '[{"type":"once","at":"2026-07-29T20:00:00+09:00"}]',
    cta_json: '{"label":"申込","url":"https://pay.example.com","showAtSeconds":5400}',
    tag_on_attend: 'tag-attend',
    tag_on_cta_click: null,
    created_at: 'x',
    updated_at: 'x',
    ...over,
  };
}

const env = {
  DB: {} as D1Database, LINE_CHANNEL_SECRET: SECRET, IMAGES: {} as R2Bucket,
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token', LIFF_URL: 'https://liff.line.me/999-test',
};
const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

function req(path: string, init?: RequestInit) {
  return webinarRoutes.request(path, init, env, execCtx);
}

// 管理系の更新はオーナー／管理者限定になった。LIFF 側の公開経路は認証を
// 通さないままにしたいので、認証済みで叩きたいテストだけこちらを使う。
// 権限そのものの検証は middleware/role-guard.test.ts が持つ。
const adminApp = new Hono<Env>();
adminApp.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
  return next();
});
adminApp.route('/', webinarRoutes);

function adminReq(path: string, init?: RequestInit) {
  return adminApp.request(path, init, env, execCtx);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  // ライブ開始3分後（予約済み本人が途中参加できる5分窓内）
  vi.setSystemTime(new Date((SESSION_START + 180) * 1000));
  authMock.verifyCallerLineUserId.mockResolvedValue('U123');
  dbMocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1' });
  dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({ id: 'friend-1' });
  dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar());
  dbMocks.getWebinarComments.mockResolvedValue([
    { id: 'c1', webinar_id: 'w1', at_seconds: 10, author_name: '田中', body: '楽しみ!', created_at: 'x' },
  ]);
  dbMocks.upsertWebinarViewer.mockResolvedValue({ firstJoin: true });
  dbMocks.getWebinarCtas.mockResolvedValue([]);
  dbMocks.getUpcomingWebinarRegistration.mockResolvedValue(null);
  dbMocks.getWebinarRegistration.mockResolvedValue({
    id: 'reg-current', webinar_id: 'w1', friend_id: 'friend-1',
    session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
  });
  localProxyMock.dispatchLineProxyLocally.mockResolvedValue(new Response(null, { status: 200 }));
  dbMocks.recordWebinarPickerOpen.mockResolvedValue(undefined);
  webinarNotificationMocks.getWebinarNotificationSettings.mockResolvedValue(null);
  webinarNotificationMocks.getWebinarNotificationOverview.mockResolvedValue({
    total: 0, pending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0,
  });
  webinarNotificationMocks.registerWebinarSession.mockResolvedValue({
    registration: {
      id: 'reg-current', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, status: 'active',
      cancelled_at: null, created_at: 'x',
    },
    created: true,
    rescheduled: false,
  });
  webinarNotificationMocks.saveWebinarNotificationSettings.mockResolvedValue({
    settings: {
      webinarId: 'w1', version: 1, registrationEnabled: true,
      dayBeforeEnabled: true, dayBeforeTime: '20:00', hourBeforeEnabled: true,
      hourBeforeMinutes: 60, startEnabled: true, missedEnabled: true,
      missedTime: '10:00', completedEnabled: true, updatedAt: 'x',
    },
    queued: 4,
    cancelled: 0,
  });
  webinarNotificationMocks.sendWebinarNotificationTest.mockResolvedValue({ sent: 1, failed: 0 });
  dbMocks.applyMileageRulesForEvent.mockResolvedValue({
    event: { id: 'mileage-event-1' }, granted: [],
  });
  accountAccessMock.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccessMock.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-a'], canSeeUnassigned: false,
  });
});

describe('admin webinar tenant scope', () => {
  test('一覧はリクエスト元の統括から見えるアカウントだけをSQLで絞る', async () => {
    const all = vi.fn(async () => ({ results: [makeWebinar({ account_id: 'account-a' })] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const originalDb = env.DB;
    env.DB = { prepare } as unknown as D1Database;

    const res = await adminReq('/api/webinars');

    env.DB = originalDb;
    expect(res.status).toBe(200);
    expect(String(prepare.mock.calls[0]?.[0])).toContain('account_id IN (?)');
    expect(bind).toHaveBeenCalledWith('account-a');
    expect((await res.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  test('一覧で選んだLINEアカウントだけをSQLで絞る', async () => {
    const all = vi.fn(async () => ({ results: [makeWebinar({ account_id: 'account-a' })] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const originalDb = env.DB;
    env.DB = { prepare } as unknown as D1Database;

    const res = await adminReq('/api/webinars?account_id=account-a');

    env.DB = originalDb;
    expect(res.status).toBe(200);
    expect(String(prepare.mock.calls[0]?.[0])).toContain('WHERE account_id = ?');
    expect(bind).toHaveBeenCalledWith('account-a');
  });

  test('一覧で別統括のLINEアカウントを指定しても存在を返さない', async () => {
    const res = await adminReq('/api/webinars?account_id=account-b');
    expect(res.status).toBe(404);
  });

  test.each([
    ['GET', '/api/webinars/w-other'],
    ['PUT', '/api/webinars/w-other'],
    ['DELETE', '/api/webinars/w-other'],
    ['GET', '/api/webinars/w-other/comments'],
    ['PUT', '/api/webinars/w-other/comments'],
    ['GET', '/api/webinars/w-other/ctas'],
    ['PUT', '/api/webinars/w-other/ctas'],
    ['GET', '/api/webinars/w-other/analytics'],
    ['GET', '/api/webinars/w-other/user-comments'],
    ['GET', '/api/webinars/w-other/notifications'],
    ['PUT', '/api/webinars/w-other/notifications'],
    ['POST', '/api/webinars/w-other/notifications/test'],
  ])('%s %s は別統括のウェビナーを404にする', async (method, path) => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ id: 'w-other', account_id: 'account-b' }));
    accountAccessMock.canAccessAllLineAccounts.mockResolvedValue(false);

    const res = await adminReq(path, {
      method,
      headers: method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'PUT' ? '{}' : undefined,
    });

    expect(res.status).toBe(404);
  });

  test('作成と更新は別統括のaccountIdを保存前に403にする', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
    accountAccessMock.canAccessAllLineAccounts.mockImplementation(async (_db, _staff, ids) => (
      ids[0] !== 'account-b'
    ));

    const create = await adminReq('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '拒否', slug: 'denied', accountId: 'account-b' }),
    });
    const update = await adminReq('/api/webinars/w1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-b' }),
    });

    expect(create.status).toBe(403);
    expect(update.status).toBe(403);
    expect(dbMocks.createWebinar).not.toHaveBeenCalled();
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });
});

describe('GET /api/liff/webinars/:slug', () => {
  test('ライブ中は offset とプレイリスト URL とコメントを返す', async () => {
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.offsetSeconds).toBe(180);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.playlistUrl).toMatch(
      /^\/webinar-assets\/\d+\.[A-Za-z0-9_-]+\/test-webinar\/master\.m3u8$/,
    );
    expect(body.comments).toEqual([{ atSeconds: 10, authorName: '田中', body: '楽しみ!' }]);
    // 予約済み本人だけが動画 URL を受け取る
    expect(body.upcoming).toEqual([]);
    expect(body.registeredSessionAt).toBeNull();
    expect(body.registeredForThisSession).toBe(true);
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith({}, 'w1', 'friend-1', SESSION_START);
  });

  test('friend はウェビナーのアカウント配下の行を優先解決する', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ account_id: 'acc-b' }));
    await req('/api/liff/webinars/test-webinar', { headers: { Authorization: 'Bearer t' } });
    expect(dbMocks.getFriendByLineUserIdForAccount).toHaveBeenCalledWith(
      expect.anything(), 'U123', 'acc-b',
    );
  });

  test('この回を予約済みの本人には registeredForThisSession=true を返す', async () => {
    dbMocks.getWebinarRegistration.mockResolvedValue({
      id: 'reg-1', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
    });
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.registeredForThisSession).toBe(true);
    expect(dbMocks.getWebinarRegistration).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('開始ぴったりでも未予約者には動画URLを返さず、現在回を予約候補にする', async () => {
    vi.setSystemTime(new Date(SESSION_START * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(execCtx.waitUntil).not.toHaveBeenCalled();
    expect(dbMocks.recordWebinarPickerOpen).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1',
    );
  });

  test('開始5分ちょうどまでは、未予約者に現在回を予約候補として出す', async () => {
    vi.setSystemTime(new Date((SESSION_START + 300) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.playlistUrl).toBeUndefined();
  });

  test('開始5分を過ぎても、その回の予約済み本人は再入場できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.offsetSeconds).toBe(301);
    expect(body.registeredForThisSession).toBe(true);
    expect(body.playlistUrl).toBeDefined();
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('開始5分を過ぎた未予約者は、現在回に入れず次回選択に戻る', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([]);
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
  });

  test('専用入場リンクは配信終了後も予約した回を再生できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 7200 + 3600) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue({
      id: 'reg-past', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
    });
    const res = await req(
      `/api/liff/webinars/test-webinar?sessionStartAt=${SESSION_START}`,
      { headers: { Authorization: 'Bearer t' } },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.replay).toBe(true);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.offsetSeconds).toBe(0);
    expect(body.registeredForThisSession).toBe(true);
    expect(body.playlistUrl).toBeDefined();
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('専用リンクの時刻を推測しても、本人の予約がなければ再生できない', async () => {
    vi.setSystemTime(new Date((SESSION_START + 7200 + 3600) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req(
      `/api/liff/webinars/test-webinar?sessionStartAt=${SESSION_START}`,
      { headers: { Authorization: 'Bearer t' } },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.replay).toBeUndefined();
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
  });

  test('tag_on_attend が waitUntil 経由で付与される', async () => {
    await req('/api/liff/webinars/test-webinar', { headers: { Authorization: 'Bearer t' } });
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });

  test('開始10分より前は live:false と nextSessionAt のみ (待機ルームなし)', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBeUndefined();
    expect(body.nextSessionAt).toBe(SESSION_START);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.registeredSessionAt).toBeNull();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(dbMocks.recordWebinarPickerOpen).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1',
    );
  });

  test('すでに未来回を予約済みなら予約画面の離脱として記録しない', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-future', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(dbMocks.recordWebinarPickerOpen).not.toHaveBeenCalled();
  });

  test('開始10分前でも未予約者は待機ルームへ直行せず、予約画面を出す', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBeUndefined();
    expect(body.upcoming).toEqual([SESSION_START]);
  });

  test('開始10分前から予約済み本人だけ待機ルームに入る', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-next', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    dbMocks.getWebinarComments.mockResolvedValue([
      { id: 'c0', webinar_id: 'w1', at_seconds: -120, author_name: 'みお', body: '楽しみ', created_at: 'x' },
    ]);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBe(true);
    expect(body.offsetSeconds).toBe(-300);
    expect(body.nextSessionAt).toBe(SESSION_START);
    expect(body.comments).toEqual([{ atSeconds: -120, authorName: 'みお', body: '楽しみ' }]);
    expect(body.playlistUrl).toBeUndefined();
    // 待機中は視聴ログを作らない
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(execCtx.waitUntil).not.toHaveBeenCalled();
  });

  test('待機窓の境界 (ちょうど600秒前) は待機ルーム', async () => {
    vi.setSystemTime(new Date((SESSION_START - 600) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-next', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.waiting).toBe(true);
  });

  test('id_token 検証失敗は 401', async () => {
    authMock.verifyCallerLineUserId.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar');
    expect(res.status).toBe(401);
  });

  test('未認証の場合、webinar が存在しなくても 401 が返る(存在オラクル防止)', async () => {
    authMock.verifyCallerLineUserId.mockResolvedValue(null);
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/does-not-exist');
    expect(res.status).toBe(401);
    expect(dbMocks.getWebinarBySlug).not.toHaveBeenCalled();
  });

  test('friend 未登録は 403', async () => {
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(403);
  });

  test('draft ウェビナーは 404', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ status: 'draft' }));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /webinar-assets/:token/:slug/*', () => {
  function makeR2(objects: Record<string, string>) {
    return {
      get: vi.fn(async (key: string) =>
        objects[key] !== undefined
          ? {
              body: objects[key], etag: 'etag1', httpMetadata: {},
              text: async () => objects[key],
            }
          : null,
      ),
    };
  }

  test('有効トークンでセグメント配信・content-type/cache 設定', async () => {
    const r2 = makeR2({ 'webinars/test-webinar/0/seg_0001.ts': 'DATA' });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/seg_0001.ts`,
      undefined,
      { ...env, IMAGES: r2 as unknown as R2Bucket },
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp2t');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  test('m3u8 は mpegurl・短キャッシュ', async () => {
    const r2 = makeR2({ 'webinars/test-webinar/master.m3u8': '#EXTM3U' });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8`,
      undefined,
      { ...env, IMAGES: r2 as unknown as R2Bucket },
      execCtx,
    );
    expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  test('?at= 付き master は EXT-X-START 注入 + variant URI へ at 伝播 + no-store', async () => {
    const master = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3506325\n0/index.m3u8\n\n#EXT-X-STREAM-INF:BANDWIDTH=1842400\n1/index.m3u8\n';
    const r2 = makeR2({ 'webinars/test-webinar/master.m3u8': master });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXT-X-START:TIME-OFFSET=571,PRECISE=YES');
    expect(body).toContain('0/index.m3u8?at=571');
    expect(body).toContain('1/index.m3u8?at=571');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('?at= 付き variant (media playlist) はタグ注入のみでセグメント URI は不変', async () => {
    const media = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.0,\nseg_00000.ts\n#EXT-X-ENDLIST\n';
    const r2 = makeR2({ 'webinars/test-webinar/0/index.m3u8': media });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/index.m3u8?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    const body = await res.text();
    expect(body).toContain('#EXT-X-START:TIME-OFFSET=571,PRECISE=YES');
    expect(body).toContain('\nseg_00000.ts\n');
    expect(body).not.toContain('seg_00000.ts?at');
  });

  test('?at= が範囲外 (負・動画長超) は 400、セグメントの at は無視', async () => {
    const r2 = makeR2({
      'webinars/test-webinar/master.m3u8': '#EXTM3U',
      'webinars/test-webinar/0/seg_0001.ts': 'DATA',
    });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const over = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=999999`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(over.status).toBe(400);
    const neg = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=-5`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(neg.status).toBe(400);
    const seg = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/seg_0001.ts?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe('DATA');
  });

  test('不正トークンは 403、存在しないキーは 404、パストラバーサルは 400', async () => {
    const r2 = makeR2({});
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const bad = await webinarRoutes.request(
      `/webinar-assets/badtoken/test-webinar/master.m3u8`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(bad.status).toBe(403);
    const missing = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/nope.ts`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(missing.status).toBe(404);
    const traversal = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/..%2Fsecret.txt`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(traversal.status).toBe(400);
  });
});

function postJson(path: string, body: unknown) {
  return req(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/liff/webinars/:slug/heartbeat', () => {
  test('位置を記録する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: SESSION_START,
      positionSeconds: 1234,
    });
    expect(res.status).toBe(200);
    expect(dbMocks.updateWebinarViewerPosition).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START, 1234,
    );
  });

  test('90%視聴で完了通知を一度だけ作る処理へ渡す', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: SESSION_START,
      positionSeconds: 6480,
    });
    expect(res.status).toBe(200);
    expect(webinarNotificationMocks.enqueueWebinarCompletedNotification).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('動画長+60秒を超える位置は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: SESSION_START,
      positionSeconds: 7261,
    });
    expect(res.status).toBe(422);
  });

  test('数値でない body は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: 'x', positionSeconds: 'y',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/liff/webinars/:slug/comments', () => {
  beforeEach(() => {
    dbMocks.countSessionUserComments.mockResolvedValue(0);
  });

  test('コメントを保存する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 100, body: 'こんにちは',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.insertWebinarUserComment).toHaveBeenCalledWith(expect.anything(), {
      webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
      atSeconds: 100, body: 'こんにちは',
    });
  });

  test('空文字・500字超は 422', async () => {
    const empty = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: '  ',
    });
    expect(empty.status).toBe(422);
    const long = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'あ'.repeat(501),
    });
    expect(long.status).toBe(422);
  });

  test('セッション60件超は 429', async () => {
    dbMocks.countSessionUserComments.mockResolvedValue(60);
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'x',
    });
    expect(res.status).toBe(429);
  });

  test('待機窓より前の投稿は 409', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'x',
    });
    expect(res.status).toBe(409);
    expect(dbMocks.insertWebinarUserComment).not.toHaveBeenCalled();
  });

  test('待機ルーム中は次回セッション帰属で負の atSeconds を保存する', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: -300, body: '待機中です',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.insertWebinarUserComment).toHaveBeenCalledWith(expect.anything(), {
      webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
      atSeconds: -300, body: '待機中です',
    });
  });

  test('待機ルーム中でも偽 sessionStartAt は 409', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START - 86400, atSeconds: -300, body: 'x',
    });
    expect(res.status).toBe(409);
  });

  test('-3600 を下回る atSeconds は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: -4000, body: 'x',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/liff/webinars/:slug/cta-click', () => {
  test('クリックを記録する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/cta-click', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
    expect(dbMocks.recordWebinarCtaClick).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
    expect(dbMocks.recordWebinarFunnelEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
        eventType: 'cta_click',
      }),
    );
  });

  test('tag_on_cta_click 設定時はタグ付与が waitUntil で走る', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ tag_on_cta_click: 'tag-cta' }));
    (execCtx.waitUntil as ReturnType<typeof vi.fn>).mockClear();
    await postJson('/api/liff/webinars/test-webinar/cta-click', {
      sessionStartAt: SESSION_START,
    });
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });
});

describe('POST /api/liff/webinars/:slug/funnel-event', () => {
  test('予約済み本人のフォーム段階を記録する', async () => {
    dbMocks.getWebinarCtas.mockResolvedValue([{ id: 'cta-1', form_id: 'form-1' }]);
    const res = await postJson('/api/liff/webinars/test-webinar/funnel-event', {
      sessionStartAt: SESSION_START,
      eventType: 'field_complete',
      ctaId: 'cta-1',
      formId: 'form-1',
      fieldName: 'annual_revenue',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.recordWebinarFunnelEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        webinarId: 'w1', friendId: 'friend-1', eventType: 'field_complete',
        fieldName: 'annual_revenue',
      }),
    );
  });

  test('未予約セッションは記録しない', async () => {
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await postJson('/api/liff/webinars/test-webinar/funnel-event', {
      sessionStartAt: SESSION_START,
      eventType: 'form_start',
    });
    expect(res.status).toBe(409);
    expect(dbMocks.recordWebinarFunnelEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/liff/webinars/:slug/register', () => {
  test('実在する未来セッションを予約し確認プッシュを waitUntil で送る', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
    expect(webinarNotificationMocks.registerWebinarSession).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });

  test('スケジュール上に存在しない時刻は 400', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START + 123,
    });
    expect(res.status).toBe(400);
    expect(webinarNotificationMocks.registerWebinarSession).not.toHaveBeenCalled();
  });

  test('開始5分ちょうどまでは現在セッションを予約できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
  });

  test('開始5分を1秒でも過ぎた現在セッションは 400', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(400);
  });
});

describe('webinar notification settings', () => {
  test('staff は通知設定を変更できない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
    const staffApp = new Hono<Env>();
    staffApp.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-1', name: 'Staff', role: 'staff', readOnly: false });
      return next();
    });
    staffApp.route('/', webinarRoutes);

    const res = await staffApp.request('/api/webinars/w1/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, env, execCtx);

    expect(res.status).toBe(403);
    expect(webinarNotificationMocks.saveWebinarNotificationSettings).not.toHaveBeenCalled();
  });

  test('GET は設定と実行状況を同じ応答で返す', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
    webinarNotificationMocks.getWebinarNotificationSettings.mockResolvedValue({
      webinarId: 'w1', version: 2, registrationEnabled: true,
      dayBeforeEnabled: true, dayBeforeTime: '20:00', hourBeforeEnabled: true,
      hourBeforeMinutes: 60, startEnabled: true, missedEnabled: true,
      missedTime: '10:00', completedEnabled: true, updatedAt: 'x',
    });
    webinarNotificationMocks.getWebinarNotificationOverview.mockResolvedValue({
      total: 8, pending: 4, sent: 2, failed: 1, skipped: 1, cancelled: 0,
    });

    const res = await adminReq('/api/webinars/w1/notifications');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        settings: expect.objectContaining({ version: 2 }),
        overview: expect.objectContaining({ total: 8, failed: 1 }),
      }),
    }));
  });

  test('PUT は全項目が揃った設定だけを保存する', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
    const input = {
      registrationEnabled: true,
      dayBeforeEnabled: true,
      dayBeforeTime: '20:00',
      hourBeforeEnabled: true,
      hourBeforeMinutes: 60,
      startEnabled: true,
      missedEnabled: true,
      missedTime: '10:00',
      completedEnabled: true,
    };

    const res = await adminReq('/api/webinars/w1/notifications', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });

    expect(res.status).toBe(200);
    expect(webinarNotificationMocks.saveWebinarNotificationSettings).toHaveBeenCalledWith(
      expect.anything(), 'w1', input,
    );
    const invalid = await adminReq('/api/webinars/w1/notifications', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
  });

  test.each(['invalid_time', 'invalid_hour_before'])(
    'PUT は設定値エラー %s を 400 で返す',
    async (message) => {
      dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
      webinarNotificationMocks.saveWebinarNotificationSettings.mockRejectedValueOnce(
        new Error(message),
      );
      const input = {
        registrationEnabled: true,
        dayBeforeEnabled: true,
        dayBeforeTime: '20:00',
        hourBeforeEnabled: true,
        hourBeforeMinutes: 60,
        startEnabled: true,
        missedEnabled: true,
        missedTime: '10:00',
        completedEnabled: true,
      };

      const res = await adminReq('/api/webinars/w1/notifications', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: message });
    },
  );

  test('テスト送信は次の実在セッションと所属アカウントを使う', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));

    const res = await adminReq('/api/webinars/w1/notifications/test', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(webinarNotificationMocks.sendWebinarNotificationTest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'w1', accountId: 'account-a' }),
      SESSION_START,
      expect.objectContaining({ defaultLiffId: '999-test' }),
    );
  });

  test('存在しないウェビナーへのテスト送信は 404', async () => {
    dbMocks.getWebinarById.mockResolvedValue(null);

    const res = await adminReq('/api/webinars/missing/notifications/test', { method: 'POST' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Not found' });
    expect(webinarNotificationMocks.sendWebinarNotificationTest).not.toHaveBeenCalled();
  });

  test('次回開催がないウェビナーへのテスト送信は 400', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({
      account_id: 'account-a',
      schedule_json: '[]',
    }));

    const res = await adminReq('/api/webinars/w1/notifications/test', { method: 'POST' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'no_upcoming_session' });
    expect(webinarNotificationMocks.sendWebinarNotificationTest).not.toHaveBeenCalled();
  });

  test.each([
    ['no_test_recipients', 400],
    ['db unavailable', 500],
  ])('テスト送信失敗 %s をHTTP %iで返す', async (message, expectedStatus) => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar({ account_id: 'account-a' }));
    webinarNotificationMocks.sendWebinarNotificationTest.mockRejectedValueOnce(
      new Error(message),
    );

    const res = await adminReq('/api/webinars/w1/notifications/test', { method: 'POST' });

    expect(res.status).toBe(expectedStatus);
    expect(await res.json()).toMatchObject({ success: false });
  });
});

describe('admin CRUD', () => {
  test('POST /api/webinars — 作成して serialize して返す', async () => {
    // beforeEach は slug 既存の mock を入れているので、新規作成用に null に戻す
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    dbMocks.createWebinar.mockResolvedValue(makeWebinar());
    const res = await adminReq('/api/webinars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-a',
        title: 'テストウェビナー',
        slug: 'test-webinar',
        durationSeconds: 7200,
        schedule: [{ type: 'once', at: '2026-07-29T20:00:00+09:00' }],
        cta: { label: '申込', url: 'https://pay.example.com', showAtSeconds: 5400 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe('test-webinar');
    expect(body.data.cta).toEqual({ label: '申込', url: 'https://pay.example.com', showAtSeconds: 5400 });
    expect(body.data.schedule).toEqual([{ type: 'once', at: '2026-07-29T20:00:00+09:00' }]);
  });

  test('POST — title/slug 欠落・slug 形式違反は 400', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    const noTitle = await adminReq('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', slug: 'x' }),
    });
    expect(noTitle.status).toBe(400);
    const badSlug = await adminReq('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', title: 't', slug: 'Bad Slug!' }),
    });
    expect(badSlug.status).toBe(400);
  });

  test('POST — LINEアカウント未指定は保存しない', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    const res = await adminReq('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '未所属', slug: 'missing-account' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'account_id_required' });
    expect(dbMocks.createWebinar).not.toHaveBeenCalled();
  });

  test('PUT /api/webinars/:id/comments — 一括置換', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.replaceWebinarComments.mockResolvedValue(2);
    const res = await adminReq('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [
          { atSeconds: 10, authorName: '田中', body: 'こんばんは!' },
          { atSeconds: 30, authorName: '鈴木', body: '楽しみです' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.replaceWebinarComments).toHaveBeenCalledWith(expect.anything(), 'w1', [
      { atSeconds: 10, authorName: '田中', body: 'こんばんは!' },
      { atSeconds: 30, authorName: '鈴木', body: '楽しみです' },
    ]);
  });

  test('PUT comments — 負の atSeconds (待機ルーム) は -3600 まで許容', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.replaceWebinarComments.mockResolvedValue(1);
    const ok = await adminReq('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [{ atSeconds: -300, authorName: 'みお', body: '楽しみです' }],
      }),
    });
    expect(ok.status).toBe(200);
    expect(dbMocks.replaceWebinarComments).toHaveBeenCalledWith(expect.anything(), 'w1', [
      { atSeconds: -300, authorName: 'みお', body: '楽しみです' },
    ]);
    const tooEarly = await adminReq('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [{ atSeconds: -4000, authorName: 'みお', body: 'x' }],
      }),
    });
    expect(tooEarly.status).toBe(400);
  });

  test('PUT comments — 不正要素があれば 400 で何も書かない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await adminReq('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [{ atSeconds: -1, authorName: '', body: '' }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarComments).not.toHaveBeenCalled();
  });

  test('GET /api/webinars/:id/analytics — summary + trend + participants', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getWebinarSessionStats.mockResolvedValue([
      { session_start_at: SESSION_START, viewers: 10, avg_watched_seconds: 3600, cta_clicks: 3 },
    ]);
    dbMocks.getWebinarDropoff.mockResolvedValue([{ bucket_start: 0, viewers: 4 }]);
    dbMocks.getWebinarAnalyticsSummary.mockResolvedValue({
      reservations: 12,
      viewers: 2,
      registered_and_joined: 1,
      watched_5m: 2,
      watched_15m: 1,
      completed: 1,
      avg_watched_seconds: 3550,
      cta_clicks: 1,
      form_submissions: 1,
    });
    dbMocks.getWebinarParticipantStats.mockResolvedValue([
      {
        friend_id: 'friend-1', friend_name: '山田太郎', picture_url: 'https://example.com/u.jpg',
        sessions: 2, first_joined_at: '2026-08-05T10:00:00+09:00',
        latest_joined_at: '2026-08-06T10:00:00+09:00', max_watched_seconds: 6500,
        cta_clicked_at: '2026-08-06T11:00:00+09:00', registered: 1,
        form_submitted_at: '2026-08-06T11:01:00+09:00',
      },
      {
        friend_id: 'friend-2', friend_name: '佐藤花子', picture_url: null,
        sessions: 1, first_joined_at: '2026-08-06T10:00:00+09:00',
        latest_joined_at: '2026-08-06T10:00:00+09:00', max_watched_seconds: 600,
        cta_clicked_at: null, registered: 0, form_submitted_at: null,
      },
    ]);
    dbMocks.getWebinarDailyStats.mockResolvedValue([
      { stat_date: '2026-08-06', reservations: 5, viewers: 4, cta_clicks: 2, form_submissions: 1 },
    ]);
    dbMocks.getWebinarFormFunnelStats.mockResolvedValue({
      cta_impressions: 10,
      cta_clicks: 8,
      form_opens: 7,
      form_starts: 6,
      submit_attempts: 5,
      submit_successes: 4,
      submit_errors: 1,
      field_completions: [{ field_name: 'annual_revenue', users: 6 }],
    });
    const res = await adminReq('/api/webinars/w1/analytics');
    const body = (await res.json()) as {
      data: {
        sessions: unknown;
        dropoff: unknown;
        summary: unknown;
        daily: unknown;
        participants: Array<Record<string, unknown>>;
        formFunnel: Record<string, unknown>;
      };
    };
    expect(body.data.sessions).toEqual([
      { sessionStartAt: SESSION_START, viewers: 10, avgWatchedSeconds: 3600, ctaClicks: 3 },
    ]);
    expect(body.data.dropoff).toEqual([{ bucketStart: 0, viewers: 4 }]);
    expect(body.data.summary).toEqual({
      reservations: 12,
      viewers: 2,
      registeredAndJoined: 1,
      watched5m: 2,
      watched15m: 1,
      completed: 1,
      avgWatchedSeconds: 3550,
      ctaClicks: 1,
      formSubmissions: 1,
    });
    expect(body.data.daily).toEqual([
      { date: '2026-08-06', reservations: 5, viewers: 4, ctaClicks: 2, formSubmissions: 1 },
    ]);
    expect(body.data.participants).toHaveLength(2);
    expect(body.data.participants[0]).toMatchObject({
      friendId: 'friend-1', friendName: '山田太郎', registered: true,
      pictureUrl: 'https://example.com/u.jpg', formSubmittedAt: '2026-08-06T11:01:00+09:00',
    });
    expect(body.data.formFunnel).toEqual({
      ctaImpressions: 10,
      ctaClicks: 8,
      formOpens: 7,
      formStarts: 6,
      submitAttempts: 5,
      submitSuccesses: 4,
      submitErrors: 1,
      fieldCompletions: [{ fieldName: 'annual_revenue', users: 6 }],
    });
  });

  test('DELETE /api/webinars/:id', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await adminReq('/api/webinars/w1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(dbMocks.deleteWebinar).toHaveBeenCalledWith(expect.anything(), 'w1');
  });

  test('PUT /api/webinars/:id — 空 title は 400 で updateWebinar が呼ばれない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await adminReq('/api/webinars/w1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });
});


describe('webinar CTA cards', () => {
  const CTA_ROW = {
    id: 'cta1', webinar_id: 'w1', at_seconds: 300, kind: 'form',
    title: '個別導入診断', body: '限定枠です', button_label: '診断を受ける',
    auto_open: 1, form_id: 'form-1', url: null, created_at: 'x', updated_at: 'x',
  };

  test('LIFF state に ctas が camelCase で含まれる', async () => {
    dbMocks.getWebinarCtas.mockResolvedValue([CTA_ROW]);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as { ctas: unknown[] };
    expect(body.ctas).toEqual([{
      id: 'cta1', atSeconds: 300, kind: 'form', title: '個別導入診断',
      body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });

  test('PUT /api/webinars/:id/ctas — form kind は forms 実在チェック後に置換', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue({ id: 'form-1', is_active: 1 });
    dbMocks.replaceWebinarCtas.mockResolvedValue(1);
    const res = await adminReq('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 300, kind: 'form', title: '個別導入診断',
        body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1',
      }] }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.replaceWebinarCtas).toHaveBeenCalledWith(expect.anything(), 'w1', [{
      atSeconds: 300, kind: 'form', title: '個別導入診断', body: '限定枠です',
      buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });

  test('PUT ctas — 存在しない form は 400 で何も書かない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue(null);
    const res = await adminReq('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'form', title: 't', buttonLabel: 'b', formId: 'nope',
      }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarCtas).not.toHaveBeenCalled();
  });

  test('PUT ctas — url kind は https 必須', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const bad = await adminReq('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'url', title: 't', buttonLabel: 'b', url: 'javascript:alert(1)',
      }] }),
    });
    expect(bad.status).toBe(400);
    dbMocks.replaceWebinarCtas.mockResolvedValue(1);
    const ok = await adminReq('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'url', title: 't', buttonLabel: 'b', url: 'https://example.com/pay',
      }] }),
    });
    expect(ok.status).toBe(200);
  });

  test('PUT ctas — 無効化されたフォームは 400', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue({ id: 'form-1', is_active: 0 });
    const res = await adminReq('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'form', title: 't', buttonLabel: 'b', formId: 'form-1',
      }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarCtas).not.toHaveBeenCalled();
  });

  test('GET /api/webinars/:id/ctas — serialize して返す', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getWebinarCtas.mockResolvedValue([CTA_ROW]);
    const res = await adminReq('/api/webinars/w1/ctas');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([{
      id: 'cta1', atSeconds: 300, kind: 'form', title: '個別導入診断',
      body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });
});
