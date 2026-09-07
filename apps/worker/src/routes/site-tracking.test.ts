import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  recordSiteEvent: vi.fn(),
  linkVisitorToFriend: vi.fn(),
  getPageViewSummary: vi.fn(),
  getFriendSiteEvents: vi.fn(),
  getOrCreateSiteTrackingKey: vi.fn(),
  getSiteTrackingAccountId: vi.fn(),
  getSiteTrackingSummary: vi.fn(),
  canAccess: vi.fn(),
  getVisibleScope: vi.fn(),
  SITE_EVENT_TYPES: ['page_view', 'click', 'scroll_depth', 'custom', 'purchase'],
}));
vi.mock('@line-crm/db', () => mocks);
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getVisibleScope,
}));

const { siteTracking } = await import('./site-tracking.js');

const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
  await next();
});
app.route('/', siteTracking);
const env = {
  DB: {
    prepare: vi.fn(() => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => ({ line_account_id: 'account-a' })),
      };
      return statement;
    }),
  } as unknown as D1Database,
  WORKER_URL: 'https://api.example.com',
};

function post(path: string, body: unknown) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env as unknown as Env['Bindings'],
  );
}

const VALID_ID = 'abc12345XYZ_-';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordSiteEvent.mockResolvedValue(undefined);
  mocks.linkVisitorToFriend.mockResolvedValue(true);
  mocks.getSiteTrackingAccountId.mockResolvedValue('account-a');
  mocks.getOrCreateSiteTrackingKey.mockResolvedValue('hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  mocks.getSiteTrackingSummary.mockResolvedValue({});
  mocks.canAccess.mockResolvedValue(true);
  mocks.getVisibleScope.mockResolvedValue({
    accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false,
    ids: ['account-a'], isAccountScoped: false,
  });
  mocks.getPageViewSummary.mockResolvedValue([]);
  mocks.getFriendSiteEvents.mockResolvedValue([]);
});

describe('収集の受け口', () => {
  it('正しい形なら記録する', async () => {
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventType: 'page_view',
      path: '/thanks',
    });
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      visitorId: VALID_ID, lineAccountId: 'account-a', eventType: 'page_view',
    }));
  });

  it('訪問者IDの形が違えば記録しない', async () => {
    const res = await post('/api/site/collect', {
      visitorId: 'x', trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', eventType: 'page_view',
    });
    // 204 は返す。エラーの形を返すと、外から叩いて内部の様子を探れてしまう。
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).not.toHaveBeenCalled();
  });

  it('知らない種別は記録しない', async () => {
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventType: 'keystroke',
    });
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).not.toHaveBeenCalled();
  });

  it('記録に失敗しても 204 を返す', async () => {
    // 外のサイトの画面が、こちらの都合でエラーを出すべきではない。
    mocks.recordSiteEvent.mockRejectedValueOnce(new Error('DB down'));
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventType: 'page_view',
    });
    expect(res.status).toBe(204);
  });

  it('CORS の許可を返す', async () => {
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID, trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', eventType: 'page_view',
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS に答える', async () => {
    const res = await app.fetch(
      new Request('https://example.com/api/site/collect', { method: 'OPTIONS' }),
      env as unknown as Env['Bindings'],
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('数値でない valueNum は落とす', async () => {
    await post('/api/site/collect', {
      visitorId: VALID_ID,
      trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventType: 'custom',
      valueNum: 'たくさん',
    });
    const [, input] = mocks.recordSiteEvent.mock.calls[0];
    expect(input.valueNum).toBeNull();
  });

  it('鍵なし・未知の鍵は記録しない', async () => {
    expect((await post('/api/site/collect', { visitorId: VALID_ID, eventType: 'page_view' })).status).toBe(204);
    expect(mocks.getSiteTrackingAccountId).not.toHaveBeenCalled();
    mocks.getSiteTrackingAccountId.mockResolvedValueOnce(null);
    expect((await post('/api/site/collect', {
      visitorId: VALID_ID,
      trackingKey: 'hk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      eventType: 'page_view',
    })).status).toBe(204);
    expect(mocks.recordSiteEvent).not.toHaveBeenCalled();
  });
});

describe('埋め込むJS', () => {
  it('WorkerのURLが差し込まれる', async () => {
    const res = await app.fetch(
      new Request('https://example.com/api/site/script.js'),
      env as unknown as Env['Bindings'],
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('javascript');
    const body = await res.text();
    expect(body).toContain('https://api.example.com/api/site/collect');
    expect(body).toContain("getAttribute('data-key')");
    expect(body).toContain('payload.trackingKey = TRACKING_KEY');
  });

  it('クエリ文字列を送らない（パスだけ）', async () => {
    const res = await app.fetch(
      new Request('https://example.com/api/site/script.js'),
      env as unknown as Env['Bindings'],
    );
    const body = await res.text();
    // location.search を読んでいないこと。送らないに越したことはない。
    expect(body).toContain('location.pathname');
    expect(body).not.toContain('location.search');
  });
});

describe('友だちとの結びつけ', () => {
  it('形が正しければ結びつける', async () => {
    const res = await post('/api/site/link', {
      visitorId: VALID_ID,
      friendId: 'f-1',
      via: 'liff',
    });
    expect(res.status).toBe(200);
    expect(mocks.linkVisitorToFriend).toHaveBeenCalledWith(
      env.DB, VALID_ID, 'account-a', 'f-1', 'liff',
    );
  });

  it('知らない経路は manual に寄せる', async () => {
    await post('/api/site/link', { visitorId: VALID_ID, friendId: 'f-1', via: 'telepathy' });
    expect(mocks.linkVisitorToFriend).toHaveBeenCalledWith(
      env.DB, VALID_ID, 'account-a', 'f-1', 'manual',
    );
  });

  it('既に別の人と結びついていたら linked=false', async () => {
    // 上書きしない。同じ端末を家族で使う場合など、後から付け替わると
    // 過去の行動まで別人のものになる。
    mocks.linkVisitorToFriend.mockResolvedValue(false);
    const res = await post('/api/site/link', { visitorId: VALID_ID, friendId: 'f-2' });
    const body = (await res.json()) as { data: { linked: boolean } };
    expect(body.data.linked).toBe(false);
  });

  it('形が違えば400', async () => {
    const res = await post('/api/site/link', { visitorId: 'x', friendId: 'f-1' });
    expect(res.status).toBe(400);
  });
});

describe('管理画面のアカウント境界', () => {
  it('可視アカウントだけに安定した計測鍵を返す', async () => {
    const res = await app.fetch(
      new Request('https://example.com/api/site/tracking-key?accountId=account-a'),
      env as unknown as Env['Bindings'],
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { accountId: 'account-a', trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(mocks.getOrCreateSiteTrackingKey).toHaveBeenCalledWith(env.DB, 'account-a');
  });

  it('不可視アカウントの鍵・集計をDB処理前に隠す', async () => {
    const key = await app.fetch(
      new Request('https://example.com/api/site/tracking-key?accountId=account-b'),
      env as unknown as Env['Bindings'],
    );
    const summary = await app.fetch(
      new Request('https://example.com/api/site/summary?accountId=account-b'),
      env as unknown as Env['Bindings'],
    );
    expect(key.status).toBe(404);
    expect(summary.status).toBe(404);
    expect(mocks.getOrCreateSiteTrackingKey).not.toHaveBeenCalled();
    expect(mocks.getSiteTrackingSummary).not.toHaveBeenCalled();
  });

  it('単一の可視アカウントなら旧画面のaccountId省略を安全に補う', async () => {
    const summary = await app.fetch(
      new Request('https://example.com/api/site/summary'),
      env as unknown as Env['Bindings'],
    );

    expect(summary.status).toBe(200);
    expect(mocks.getSiteTrackingSummary).toHaveBeenCalledWith(env.DB, 'account-a');
  });

  it('複数アカウントではaccountId省略を拒否する', async () => {
    mocks.getVisibleScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a', 'account-b'], canSeeUnassigned: false,
      ids: ['account-a', 'account-b'], isAccountScoped: false,
    });
    const summary = await app.fetch(
      new Request('https://example.com/api/site/summary'),
      env as unknown as Env['Bindings'],
    );

    expect(summary.status).toBe(400);
    expect(mocks.getSiteTrackingSummary).not.toHaveBeenCalled();
  });

  it('集計とページ閲覧を選択アカウントで絞る', async () => {
    expect((await app.fetch(
      new Request('https://example.com/api/site/summary?accountId=account-a'),
      env as unknown as Env['Bindings'],
    )).status).toBe(200);
    expect(mocks.getSiteTrackingSummary).toHaveBeenCalledWith(env.DB, 'account-a');

    expect((await app.fetch(
      new Request('https://example.com/api/site/pages?accountId=account-a&from=2026-09-01&to=2026-09-07'),
      env as unknown as Env['Bindings'],
    )).status).toBe(200);
    expect(mocks.getPageViewSummary).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-a', from: '2026-09-01', to: '2026-09-07T23:59:59.999',
    });
  });
});
