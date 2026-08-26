import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { richMenus } from './rich-menus.js';

const uploadRichMenuImage = vi.fn();
const getRichMenuList = vi.fn();
const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    uploadRichMenuImage,
    getRichMenuList,
  })),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope,
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
