import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  recordSiteEvent: vi.fn(),
  linkVisitorToFriend: vi.fn(),
  getPageViewSummary: vi.fn(),
  getFriendSiteEvents: vi.fn(),
  SITE_EVENT_TYPES: ['page_view', 'click', 'scroll_depth', 'custom', 'purchase'],
};
vi.mock('@line-crm/db', () => mocks);

const { siteTracking } = await import('./site-tracking.js');

const app = new Hono<Env>();
app.route('/', siteTracking);
const env = { DB: {} as D1Database, WORKER_URL: 'https://api.example.com' };

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
  mocks.linkVisitorToFriend.mockResolvedValue(true);
  mocks.getPageViewSummary.mockResolvedValue([]);
  mocks.getFriendSiteEvents.mockResolvedValue([]);
});

describe('収集の受け口', () => {
  it('正しい形なら記録する', async () => {
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      eventType: 'page_view',
      path: '/thanks',
    });
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).toHaveBeenCalled();
  });

  it('訪問者IDの形が違えば記録しない', async () => {
    const res = await post('/api/site/collect', { visitorId: 'x', eventType: 'page_view' });
    // 204 は返す。エラーの形を返すと、外から叩いて内部の様子を探れてしまう。
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).not.toHaveBeenCalled();
  });

  it('知らない種別は記録しない', async () => {
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      eventType: 'keystroke',
    });
    expect(res.status).toBe(204);
    expect(mocks.recordSiteEvent).not.toHaveBeenCalled();
  });

  it('記録に失敗しても 204 を返す', async () => {
    // 外のサイトの画面が、こちらの都合でエラーを出すべきではない。
    mocks.recordSiteEvent.mockRejectedValue(new Error('DB down'));
    const res = await post('/api/site/collect', {
      visitorId: VALID_ID,
      eventType: 'page_view',
    });
    expect(res.status).toBe(204);
  });

  it('CORS の許可を返す', async () => {
    const res = await post('/api/site/collect', { visitorId: VALID_ID, eventType: 'page_view' });
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
      eventType: 'custom',
      valueNum: 'たくさん',
    });
    const [, input] = mocks.recordSiteEvent.mock.calls[0];
    expect(input.valueNum).toBeNull();
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
    expect(mocks.linkVisitorToFriend).toHaveBeenCalledWith(env.DB, VALID_ID, 'f-1', 'liff');
  });

  it('知らない経路は manual に寄せる', async () => {
    await post('/api/site/link', { visitorId: VALID_ID, friendId: 'f-1', via: 'telepathy' });
    expect(mocks.linkVisitorToFriend).toHaveBeenCalledWith(env.DB, VALID_ID, 'f-1', 'manual');
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
