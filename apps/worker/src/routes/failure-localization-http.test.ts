import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { apiContractMiddleware } from '../middleware/api-contract.js';
import { accountSettings } from './account-settings.js';
import { richMenus } from './rich-menus.js';

vi.mock('@line-crm/db', async importOriginal => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getFriendById: vi.fn(async () => null),
}));
afterEach(() => vi.unstubAllGlobals());

function app() {
  const api = new Hono<Env>().use('*', apiContractMiddleware);
  api.use('*', async (c, next) => {
    c.set('staff', { id: 'owner', name: '担当者', role: 'owner', readOnly: false });
    await next();
  });
  api.route('/', accountSettings);
  api.route('/', richMenus);
  return api;
}

describe('既存の業務APIから返す日本語の案内', () => {
  it.each(['test-recipients', 'test-recipient-login-users'])('アカウント未選択: %s', async path => {
    const fetch = vi.fn(() => { throw new Error('外部接続は禁止'); });
    vi.stubGlobal('fetch', fetch);
    const response = await app().request('/api/account-settings/' + path);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: {
      code: 'ACCOUNT_ID_REQUIRED', message: 'LINE公式アカウントを選んでください。', fieldErrors: [],
    } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('友だちがないとき、LINEへ送信せず対象を選び直す理由を返す', async () => {
    const fetch = vi.fn(() => { throw new Error('外部接続は禁止'); });
    vi.stubGlobal('fetch', fetch);
    const response = await app().request('/api/friends/missing/rich-menu', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ richMenuId: 'menu' }) },
    { DB: {} as D1Database });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: {
      code: 'FRIEND_NOT_FOUND', message: '友だちが見つかりません。一覧から開き直してください。',
    } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
