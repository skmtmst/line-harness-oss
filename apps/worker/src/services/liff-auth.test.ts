import { afterEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getLineAccountLoginChannels: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { verifyCallerLineIdentity, verifyCallerLineUserId } from './liff-auth.js';

const DB = {} as D1Database;
const token = (aud: string) => `header.${btoa(JSON.stringify({ aud }))}.signature`;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('LIFF caller identity', () => {
  test('returns the LINE account that owns the verified login channel', async () => {
    dbMocks.getLineAccountLoginChannels.mockResolvedValue([
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

    await expect(verifyCallerLineIdentity(`Bearer ${token('login-b')}`, {
      DB,
      LINE_LOGIN_CHANNEL_ID: 'login-a',
    })).resolves.toEqual({
      lineUserId: 'U-line-user',
      lineAccountId: 'account-b',
    });
  });

  test('keeps the existing user-id-only helper behavior', async () => {
    dbMocks.getLineAccountLoginChannels.mockResolvedValue([
      { id: 'account-a', login_channel_id: 'login-a' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ sub: 'U-line-user' }), { status: 200 })));

    await expect(verifyCallerLineUserId(`Bearer ${token('login-a')}`, {
      DB,
      LINE_LOGIN_CHANNEL_ID: 'login-a',
    })).resolves.toBe('U-line-user');
  });
});

test('LIFFで指定したアカウントのチャンネルだけで本人確認する', async () => {
 dbMocks.getLineAccountLoginChannels.mockResolvedValue([{id:'a',login_channel_id:'login-a'},{id:'b',login_channel_id:'login-b'}]);
 const verify=vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({sub:'U1'}),{status:200}));vi.stubGlobal('fetch',verify);
 expect(await verifyCallerLineIdentity('Bearer token',{DB,LINE_LOGIN_CHANNEL_ID:'login-a'},'b')).toEqual({lineUserId:'U1',lineAccountId:'b'});
 expect(verify).toHaveBeenCalledTimes(1);expect(new URLSearchParams(String(verify.mock.calls[0][1]?.body)).get('client_id')).toBe('login-b');
 expect(await verifyCallerLineIdentity('Bearer token',{DB},'missing')).toBeNull();expect(verify).toHaveBeenCalledTimes(1);
});

test('S15 an account without its login channel never falls back to another store environment channel', async () => {
  dbMocks.getLineAccountLoginChannels.mockResolvedValue([{ id: 'a', login_channel_id: null }]);
  const verify = vi.fn(async () => Response.json({ sub: 'Ufixture' }));
  vi.stubGlobal('fetch', verify);
  await expect(verifyCallerLineUserId('Bearer fixture', { DB, LINE_LOGIN_CHANNEL_ID: 'other-login' }, 'a')).resolves.toBeNull();
  expect(verify).not.toHaveBeenCalled();
});

test('S15 an unassigned legacy resource only accepts channels from the default tenant', async () => {
  dbMocks.getLineAccountLoginChannels.mockResolvedValue([
    { id: 'default', tenant_id: null, login_channel_id: 'default-login' },
    { id: 'other', tenant_id: 'other-tenant', login_channel_id: 'other-login' },
  ]);
  const verify = vi.fn(async (_url: unknown, init?: RequestInit) => {
    return new URLSearchParams(String(init?.body)).get('client_id') === 'other-login'
      ? Response.json({ sub: 'Ufixture' }) : new Response('invalid', { status: 400 });
  });
  vi.stubGlobal('fetch', verify);
  expect(await verifyCallerLineUserId(`Bearer ${token('other-login')}`, { DB, LINE_LOGIN_CHANNEL_ID: 'other-login' }, null)).toBeNull();
  expect(verify).not.toHaveBeenCalled();
});


test('a rejected token is checked once without trying every configured store', async () => {
  dbMocks.getLineAccountLoginChannels.mockResolvedValue([{ id: 'b', login_channel_id: 'login-b' }]);
  const verify = vi.fn(async () => new Response('invalid', { status: 400 }));
  vi.stubGlobal('fetch', verify);
  expect(await verifyCallerLineIdentity(`Bearer ${token('login-b')}`, { DB, LINE_LOGIN_CHANNEL_ID: 'login-a' })).toBeNull();
  expect(dbMocks.getLineAccountLoginChannels).toHaveBeenCalledWith(DB, { loginChannelId: 'login-b' });
  expect(verify).toHaveBeenCalledTimes(1);
});

test('a malformed unscoped token does not trigger account reads or verification calls', async () => {
  const verify = vi.fn();
  vi.stubGlobal('fetch', verify);
  expect(await verifyCallerLineIdentity('Bearer invalid', { DB })).toBeNull();
  expect(dbMocks.getLineAccountLoginChannels).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});
