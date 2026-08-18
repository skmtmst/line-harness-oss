import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { accountSettings } from './account-settings.js';

const app = new Hono();
app.route('/', accountSettings);

describe('GET /api/account-settings/test-recipient-login-users', () => {
  test('accountIdがない場合はDBを読まない', async () => {
    const prepare = vi.fn();
    const response = await app.request('/api/account-settings/test-recipient-login-users', {}, {
      DB: { prepare },
    });
    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  test('LINE連携済みの有効なログインユーザーをテスト送信候補へ変換する', async () => {
    const all = vi.fn(async () => ({
      results: [
        {
          id: 'friend-masato',
          display_name: 'LINE上の表示名',
          picture_url: 'https://example.com/masato.png',
          staff_name: 'Masato.S',
          same_account: 0,
        },
        {
          id: 'friend-owner',
          display_name: null,
          picture_url: null,
          staff_name: '管理者',
          same_account: 1,
        },
      ],
    }));
    const bind = vi.fn((_accountId: string) => ({ all }));
    const prepare = vi.fn((_sql: string) => ({ bind }));

    const response = await app.request(
      '/api/account-settings/test-recipient-login-users?accountId=line-account-1',
      {},
      { DB: { prepare } },
    );

    expect(response.status).toBe(200);
    expect(bind).toHaveBeenCalledWith('line-account-1');
    expect(prepare.mock.calls[0]?.[0]).toContain('JOIN friends f ON f.line_user_id = sm.line_user_id');
    expect(await response.json()).toEqual({
      success: true,
      data: [
        {
          id: 'friend-masato',
          displayName: 'LINE上の表示名',
          pictureUrl: 'https://example.com/masato.png',
          staffName: 'Masato.S',
          sameAccount: false,
        },
        {
          id: 'friend-owner',
          displayName: '管理者',
          pictureUrl: null,
          staffName: '管理者',
          sameAccount: true,
        },
      ],
    });
  });
});
