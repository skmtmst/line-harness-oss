import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { richMenus } from './rich-menus.js';

const uploadRichMenuImage = vi.fn();
const getRichMenuList = vi.fn();
const getRichMenuIdOfUser = vi.fn();
const getDefaultRichMenuId = vi.fn();
const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());
const canAccessAllLineAccounts = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  recordRichMenuAssignment: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    uploadRichMenuImage,
    getRichMenuList,
    getRichMenuIdOfUser,
    getDefaultRichMenuId,
  })),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope,
  canAccessAllLineAccounts,
}));

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@line-crm/db')>()),
  getFriendById: dbMocks.getFriendById,
  getLineAccountById: dbMocks.getLineAccountById,
  recordRichMenuAssignment: dbMocks.recordRichMenuAssignment,
}));

describe('POST /api/rich-menus/:id/image', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    // 更新系はオーナー／管理者限定になった。ここで見たいのは本体の挙動なので、
    // 認証は通った状態にしてから渡す。権限の検証は role-guard.test.ts が持つ。
    app.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('staff', { id: 'owner-1', name: 'Owner', role: 'owner' as const, readOnly: false });
      return next();
    });
    app.route('/', richMenus);
    return app;
  }

  beforeEach(() => {
    uploadRichMenuImage.mockReset();
    uploadRichMenuImage.mockResolvedValue(undefined);
    getRichMenuList.mockReset();
    getRichMenuList.mockResolvedValue({ richmenus: [] });
    getVisibleLineAccountScope.mockReset();
    getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: [], canSeeUnassigned: true, ids: [],
    });
  });

  test('rejects omitted accountId for non-default tenants before creating a LINE client', async () => {
    getVisibleLineAccountScope.mockResolvedValue({
      accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'],
    });
    const { LineClient } = await import('@line-crm/line-sdk');
    vi.mocked(LineClient).mockClear();

    const res = await setupApp().request('/api/rich-menus', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database,
    });

    expect(res.status).toBe(400);
    expect(LineClient).not.toHaveBeenCalled();
  });

  test('keeps the default channel available to default-tenant staff', async () => {
    const { LineClient } = await import('@line-crm/line-sdk');
    vi.mocked(LineClient).mockClear();

    const res = await setupApp().request('/api/rich-menus', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'default-token', DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(LineClient).toHaveBeenCalledWith('default-token');
    expect(getRichMenuList).toHaveBeenCalledOnce();
  });

  test('accepts SDK imageData JSON field for base64 uploads', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-1/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageData: 'aGVsbG8=',
        contentType: 'image/png',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-1');
    expect(contentType).toBe('image/png');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });

  test('keeps accepting legacy image JSON field', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-2/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,aGVsbG8=',
        contentType: 'image/jpeg',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-2');
    expect(contentType).toBe('image/jpeg');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });
});

describe('GET /api/friends/:friendId/rich-menu (#496-13)', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('staff', { id: 'staff-1', name: 'Staff', role: 'staff' as const, readOnly: false });
      return next();
    });
    app.route('/', richMenus);
    return app;
  }

  beforeEach(async () => {
    const { _resetFriendRichMenuCacheForTest } = await import('./rich-menus.js');
    _resetFriendRichMenuCacheForTest();
    getRichMenuIdOfUser.mockReset();
    getRichMenuIdOfUser.mockResolvedValue({ richMenuId: 'rich-menu-main' });
    getDefaultRichMenuId.mockReset();
    getDefaultRichMenuId.mockResolvedValue('rich-menu-default');
    getRichMenuList.mockReset();
    getRichMenuList.mockResolvedValue({ richmenus: [{ richMenuId: 'rich-menu-main', name: '通常メニュー' }] });
    canAccessAllLineAccounts.mockReset();
    canAccessAllLineAccounts.mockResolvedValue(true);
    dbMocks.getFriendById.mockReset();
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-a' });
    dbMocks.getLineAccountById.mockReset();
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'account-a', channel_access_token: 'account-token' });
  });

  test('見られない友だちは404に倒し、LINE APIを叩かない', async () => {
    canAccessAllLineAccounts.mockResolvedValue(false);
    const { LineClient } = await import('@line-crm/line-sdk');
    vi.mocked(LineClient).mockClear();

    const res = await setupApp().request('/api/friends/friend-1/rich-menu', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database,
    });

    expect(res.status).toBe(404);
    expect(LineClient).not.toHaveBeenCalled();
  });

  test('存在しない友だちは404に倒す', async () => {
    dbMocks.getFriendById.mockResolvedValue(null);

    const res = await setupApp().request('/api/friends/friend-gone/rich-menu', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database,
    });

    expect(res.status).toBe(404);
  });

  test('2回目はキャッシュを返し、LINE APIを叩かない', async () => {
    const { LineClient } = await import('@line-crm/line-sdk');
    vi.mocked(LineClient).mockClear();
    const app = setupApp();
    const env = { LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database };

    const first = await app.request('/api/friends/friend-1/rich-menu', {}, env);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      success: true,
      data: { id: 'rich-menu-main', name: '通常メニュー', isDefault: false },
    });
    expect(LineClient).toHaveBeenCalledTimes(1);

    const second = await app.request('/api/friends/friend-1/rich-menu', {}, env);
    expect(second.status).toBe(200);
    expect(LineClient).toHaveBeenCalledTimes(1);
  });

  test('LINE APIの失敗は内部文言を混ぜず定型文の500にする', async () => {
    getRichMenuIdOfUser.mockRejectedValue(new Error('socket hang up'));

    const res = await setupApp().request('/api/friends/friend-1/rich-menu', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token', DB: {} as D1Database,
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.error).toBe('リッチメニューを取得できませんでした');
    expect(body.error).not.toContain('socket hang up');
  });
});
