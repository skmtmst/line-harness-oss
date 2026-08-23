import { afterEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { verifyCallerLineIdentity, verifyCallerLineUserId } from './liff-auth.js';

const DB = {} as D1Database;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('LIFF caller identity', () => {
  test('returns the LINE account that owns the verified login channel', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { id: 'account-a', login_channel_id: 'login-a' },
      { id: 'account-b', login_channel_id: 'login-b' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const channelId = new URLSearchParams(String(init?.body)).get('client_id');
      if (channelId === 'login-b') {
        return new Response(JSON.stringify({ sub: 'U-line-user' }), { status: 200 });
      }
      return new Response('invalid', { status: 400 });
    }));

    await expect(verifyCallerLineIdentity('Bearer id-token', {
      DB,
      LINE_LOGIN_CHANNEL_ID: 'login-a',
    })).resolves.toEqual({
      lineUserId: 'U-line-user',
      lineAccountId: 'account-b',
    });
  });

  test('keeps the existing user-id-only helper behavior', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { id: 'account-a', login_channel_id: 'login-a' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ sub: 'U-line-user' }), { status: 200 })));

    await expect(verifyCallerLineUserId('Bearer id-token', {
      DB,
      LINE_LOGIN_CHANNEL_ID: 'login-a',
    })).resolves.toBe('U-line-user');
  });
});
