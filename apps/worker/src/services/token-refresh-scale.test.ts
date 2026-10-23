import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import { getLineAccountById } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { refreshLineAccessTokens, TOKEN_REFRESH_BATCH_SIZE } from './token-refresh.js';

const credentialKey = btoa('a'.repeat(32));
const now = new Date('2026-10-23T00:00:00Z');
let fixture: ReturnType<typeof createTestD1>;
type TestFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
let network: Mock<TestFetch>;

beforeEach(() => {
  fixture = createTestD1();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  network = vi.fn<TestFetch>(async (url, init) => {
    if (String(url).includes('/oauth/accessToken')) {
      const channel = new URLSearchParams(String(init?.body)).get('client_id');
      return Response.json({ access_token: `renewed-${channel}`, expires_in: 30 * 86_400, token_type: 'Bearer' });
    }
    return Response.json({ displayName: 'Updated display', basicId: '@fixture' });
  });
  vi.stubGlobal('fetch', network);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { fixture.raw.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function seed(count: number, expiry: string | null = '2040-01-01T00:00:00Z') {
  const insert = fixture.raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret,token_expires_at,line_profile_synced_at)
    VALUES(?,?,?,'original-token','fixture-secret',?,?)`);
  fixture.raw.transaction(() => {
    for (let index = 0; index < count; index++) {
      const id = `account-${String(index).padStart(5, '0')}`;
      insert.run(id, `channel-${id}`, id, expiry, now.toISOString());
    }
  })();
}

test('5,000 fresh accounts only load due profiles, without decrypting unrelated broken credentials', async () => {
  seed(5_000);
  fixture.raw.exec(`UPDATE line_accounts SET line_profile_synced_at=NULL
      WHERE id IN ('account-04998','account-04999');
    UPDATE line_accounts SET channel_access_token='',channel_access_token_encrypted='invalid-ciphertext'
      WHERE id='account-00000'`);
  let queries = 0;
  const counted = new Proxy(fixture.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { queries++; return target.prepare(sql); };
    return Reflect.get(target, key);
  } });
  await refreshLineAccessTokens(counted, credentialKey);
  expect(network).toHaveBeenCalledTimes(2);
  expect(network.mock.calls.every(call => String(call[0]).endsWith('/bot/info'))).toBe(true);
  expect(queries).toBeLessThan(30);
  expect(fixture.raw.prepare("SELECT count(*) n FROM line_accounts WHERE line_display_name='Updated display'").get())
    .toEqual({ n: 2 });
});

test('failed token renewal cools down while later accounts proceed, and encrypted tokens remain readable', async () => {
  seed(30, '2026-10-22T00:00:00Z');
  const normal = network.getMockImplementation()!;
  network.mockImplementation(async (url, init) => {
    const channel = new URLSearchParams(String(init?.body)).get('client_id');
    if (channel === 'channel-account-00000') return new Response('', { status: 401 });
    return normal(url, init);
  });
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network).toHaveBeenCalledTimes(TOKEN_REFRESH_BATCH_SIZE);
  expect(fixture.raw.prepare("SELECT count(*) n FROM line_accounts WHERE channel_access_token_encrypted IS NOT NULL").get())
    .toEqual({ n: TOKEN_REFRESH_BATCH_SIZE - 1 });
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network).toHaveBeenCalledTimes(30);
  expect((await getLineAccountById(fixture.db, 'account-00029', credentialKey))?.channel_access_token)
    .toBe('renewed-channel-account-00029');
  expect(fixture.raw.prepare("SELECT count(*) n FROM platform_settings WHERE key LIKE 'line-token-refresh:attempt:%'").get())
    .toEqual({ n: 1 });
  vi.setSystemTime(new Date(now.getTime() + 31 * 60_000));
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network).toHaveBeenCalledTimes(31);
});

test('unknown legacy expiry still renews, while stopped and fresh long-lived accounts do not', async () => {
  seed(3);
  fixture.raw.exec(`UPDATE line_accounts SET token_expires_at=NULL WHERE id IN ('account-00000','account-00001');
    UPDATE line_accounts SET is_active=0 WHERE id='account-00001'`);
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(String(network.mock.calls[0]![1]?.body)).get('client_id'))
    .toBe('channel-account-00000');
});

test('150 permanently failing accounts cannot starve a healthy tail after their cooldown elapses', async () => {
  seed(200, '2026-10-22T00:00:00Z');
  const normal = network.getMockImplementation()!;
  const tried = new Set<string>();
  network.mockImplementation(async (url, init) => {
    const channel = new URLSearchParams(String(init?.body)).get('client_id')!;
    tried.add(channel);
    if (Number(channel.slice(-5)) < 150) return new Response('', { status: 401 });
    return normal(url, init);
  });
  for (let tick = 0; tick < 40; tick += 1) {
    vi.setSystemTime(new Date(now.getTime() + tick * 5 * 60_000));
    await refreshLineAccessTokens(fixture.db, credentialKey);
    if (tick === 7) expect(tried.size).toBe(200);
  }
  expect(fixture.raw.prepare(`SELECT COUNT(*) AS renewed FROM line_accounts
    WHERE id >= 'account-00150' AND channel_access_token_encrypted IS NOT NULL`).get()).toEqual({ renewed: 50 });
  expect(fixture.raw.prepare(`SELECT COUNT(*) AS failed FROM platform_settings
    WHERE key LIKE 'line-token-refresh:attempt:%'`).get()).toEqual({ failed: 150 });
});

test('untouched due accounts preserve expired, unknown, expiring and profile-only urgency bands', async () => {
  seed(4);
  fixture.raw.exec(`UPDATE line_accounts SET line_profile_synced_at=NULL WHERE id='account-00000';
    UPDATE line_accounts SET token_expires_at='2026-10-26T00:00:00Z' WHERE id='account-00001';
    UPDATE line_accounts SET token_expires_at=NULL WHERE id='account-00002';
    UPDATE line_accounts SET token_expires_at='2026-10-22T00:00:00Z' WHERE id='account-00003'`);
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network.mock.calls.slice(0, 3).map(call => new URLSearchParams(String(call[1]?.body)).get('client_id')))
    .toEqual(['channel-account-00003', 'channel-account-00002', 'channel-account-00001']);
  expect(String(network.mock.calls[3]?.[0])).toContain('/bot/info');
});

test('expired retries cannot monopolize the lower urgency profile-only band', async () => {
  seed(200, '2026-10-22T00:00:00Z');
  fixture.raw.exec(`UPDATE line_accounts SET token_expires_at='2040-01-01T00:00:00Z',line_profile_synced_at=NULL
    WHERE id >= 'account-00150'`);
  const normal = network.getMockImplementation()!;
  network.mockImplementation(async (url, init) => String(url).includes('/oauth/accessToken')
    ? new Response('', { status: 401 }) : normal(url, init));
  for (let tick = 0; tick < 8; tick += 1) {
    vi.setSystemTime(new Date(now.getTime() + tick * 5 * 60_000));
    await refreshLineAccessTokens(fixture.db, credentialKey);
  }
  expect(fixture.raw.prepare(`SELECT COUNT(*) AS refreshed FROM line_accounts
    WHERE id >= 'account-00150' AND line_display_name='Updated display'`).get()).toEqual({ refreshed: 50 });
});

test('one undecryptable due account cannot abort the remaining due profiles', async () => {
  seed(2);
  fixture.raw.exec(`UPDATE line_accounts SET line_profile_synced_at=NULL;
    UPDATE line_accounts SET channel_access_token='',channel_access_token_encrypted='invalid-ciphertext'
      WHERE id='account-00000'`);
  await refreshLineAccessTokens(fixture.db, credentialKey);
  expect(network).toHaveBeenCalledTimes(1);
  expect(fixture.raw.prepare("SELECT line_display_name FROM line_accounts WHERE id='account-00001'").get())
    .toEqual({ line_display_name: 'Updated display' });
});

test('a slow token service stops before the next account and overlapping ticks share one owner', async () => {
  seed(5, '2026-10-22T00:00:00Z');
  const normal = network.getMockImplementation()!;
  network.mockImplementation(async (url, init) => {
    vi.setSystemTime(new Date(Date.now() + 30_000));
    return normal(url, init);
  });
  await Promise.all([
    refreshLineAccessTokens(fixture.db, credentialKey), refreshLineAccessTokens(fixture.db, credentialKey),
  ]);
  expect(network).toHaveBeenCalledTimes(2);
  expect(fixture.raw.prepare("SELECT count(*) n FROM line_accounts WHERE channel_access_token_encrypted IS NOT NULL").get())
    .toEqual({ n: 2 });
});
