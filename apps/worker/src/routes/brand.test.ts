import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getLineAccounts: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { brand } = await import('./brand.js');

type TestEnv = { Bindings: { DB: D1Database } };

function setupApp() {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database };
    await next();
  });
  app.route('/', brand);
  return app;
}

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    channel_id: '123456789',
    name: '本番',
    channel_access_token: 'token',
    is_active: 1,
    display_order: 0,
    icon_url: null,
    ...over,
  };
}

/** LINE の /v2/bot/info の返事を差し替える。 */
function mockBotInfo(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, json: async () => body } as Response),
  );
}

describe('GET /api/public/brand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    dbMocks.getLineAccounts.mockReset();
  });

  test('公式アカウントの表示名とアイコンを返す', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([account()]);
    mockBotInfo({ displayName: '然-NEN-', pictureUrl: 'https://line/icon.png' });

    const res = await setupApp().request('/api/public/brand');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { name: '然-NEN-', iconUrl: 'https://line/icon.png' },
    });
  });

  test('管理画面で設定したアイコンが LINE 側のアイコンより優先される', async () => {
    // 運用側が意図して差し替えたものなので、こちらを出す。
    dbMocks.getLineAccounts.mockResolvedValue([account({ icon_url: 'https://own/icon.png' })]);
    mockBotInfo({ displayName: '然-NEN-', pictureUrl: 'https://line/icon.png' });

    const res = await setupApp().request('/api/public/brand');
    expect((await res.json() as { data: { iconUrl: string } }).data.iconUrl).toBe(
      'https://own/icon.png',
    );
  });

  test('LINE の表示名が取れないときは DB の呼び名に落ちる', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([account()]);
    mockBotInfo({}, false);

    const res = await setupApp().request('/api/public/brand');
    expect(await res.json()).toEqual({
      success: true,
      data: { name: '本番', iconUrl: null },
    });
  });

  test('止まっているアカウントは飛ばし、有効なものを出す', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      account({ id: 'acc-0', is_active: 0, channel_access_token: 'stopped' }),
      account({ id: 'acc-1', is_active: 1, channel_access_token: 'live' }),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ displayName: '然-NEN-' }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await setupApp().request('/api/public/brand');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/info',
      expect.objectContaining({ headers: { Authorization: 'Bearer live' } }),
    );
  });

  test('アカウントが1件も無くても 200 で空を返す', async () => {
    // ログイン画面を出せない理由にはしない。看板が無いだけ。
    dbMocks.getLineAccounts.mockResolvedValue([]);

    const res = await setupApp().request('/api/public/brand');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { name: null, iconUrl: null } });
  });

  test('DB が落ちていても 200 で空を返す', async () => {
    dbMocks.getLineAccounts.mockRejectedValue(new Error('D1 down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await setupApp().request('/api/public/brand');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { name: null, iconUrl: null } });
  });

  test('鍵や件数を混ぜない', async () => {
    // 認証の手前で誰でも叩ける入口なので、返す形そのものを固定する。
    dbMocks.getLineAccounts.mockResolvedValue([account()]);
    mockBotInfo({ displayName: '然-NEN-', basicId: '@nen' });

    const res = await setupApp().request('/api/public/brand');
    const body = await res.json() as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(['iconUrl', 'name']);
  });
});
