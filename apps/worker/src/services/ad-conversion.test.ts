import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { sendAdConversions } from './ad-conversion.js';

const sentRequests: Array<{ url: string; body: unknown }> = [];

function mockFetchOk(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, text: async () => 'ok' };
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  sentRequests.length = 0;
});

function seedAccount(testDb: SqliteD1, id: string): void {
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

function seedPlatform(
  testDb: SqliteD1,
  id: string,
  lineAccountId: string | null,
  opts: { active?: boolean } = {},
): void {
  testDb.raw.prepare(
    `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
     VALUES (?, 'meta', 'Meta広告', '{"pixel_id":"PIXEL-1","access_token":"token-1234567890"}', ?, ?, '2026-09-08T00:00:00+09:00', '2026-09-08T00:00:00+09:00')`,
  ).run(id, opts.active === false ? 0 : 1, lineAccountId);
}

function seedRef(testDb: SqliteD1, id: string, friendId: string): void {
  testDb.raw.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id, fbclid, created_at)
     VALUES (?, 'ref-1', ?, 'fb-click-1', '2026-09-08T00:00:00+09:00')`,
  ).run(id, friendId);
}

function seedTwoAccounts(): SqliteD1 {
  const testDb = createTestD1();
  seedAccount(testDb, 'a1');
  seedAccount(testDb, 'a2');
  insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
  insertFriend(testDb.raw, 'f2', { line_account_id: 'a2' });
  seedRef(testDb, 'ref-1', 'f1');
  seedRef(testDb, 'ref-2', 'f2');
  seedPlatform(testDb, 'p1', 'a1');
  seedPlatform(testDb, 'p2', 'a2');
  seedPlatform(testDb, 'p-legacy', null);
  return testDb;
}

function logs(testDb: SqliteD1): Array<{ ad_platform_id: string; friend_id: string; line_account_id: string | null; status: string }> {
  return testDb.raw.prepare(
    `SELECT ad_platform_id, friend_id, line_account_id, status FROM ad_conversion_logs ORDER BY ad_platform_id`,
  ).all() as Array<{ ad_platform_id: string; friend_id: string; line_account_id: string | null; status: string }>;
}

describe('sendAdConversions のアカウント境界(#638)', () => {
  it('友だち所属アカウントの設定だけ外部送信・記録し、他店と帰属不明には送らない', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000);

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' },
    ]);
  });

  it('もう一方のアカウントの友だちは自アカウントの設定だけ使う', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f2', 'Purchase');

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p2', friend_id: 'f2', line_account_id: 'a2', status: 'sent' },
    ]);
  });

  it('広告クリックIDが無い友だちは何も送らない', async () => {
    const testDb = seedTwoAccounts();
    insertFriend(testDb.raw, 'f3', { line_account_id: 'a1' });
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f3', 'Purchase');

    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toHaveLength(0);
  });

  it('所属不明・存在しない友だちは送らず投げない', async () => {
    const testDb = seedTwoAccounts();
    insertFriend(testDb.raw, 'f9', { line_account_id: null });
    seedRef(testDb, 'ref-9', 'f9');
    mockFetchOk();

    await expect(sendAdConversions(testDb.db, 'f9', 'Purchase')).resolves.toBeUndefined();
    await expect(sendAdConversions(testDb.db, 'no-such-friend', 'Purchase')).resolves.toBeUndefined();
    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toHaveLength(0);
  });

  it('送信失敗は failed で記録し投げない。1回の呼び出しで1媒体へ1回だけ送る', async () => {
    const testDb = seedTwoAccounts();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: false, status: 400, text: async () => 'bad' };
    }));

    await expect(sendAdConversions(testDb.db, 'f1', 'Purchase')).resolves.toBeUndefined();

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);
  });
});
