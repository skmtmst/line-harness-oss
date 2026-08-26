import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFriendAddBreakdown } from '../src/friends.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
  });
  return {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => wrap(query, params), ...wrap(query, []) };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
});

afterEach(() => {
  sqlite.close();
});

function insertFriend(
  id: string,
  accountId: string,
  options: { unfollowCount?: number; isFollowing?: number } = {},
): void {
  sqlite.prepare(
    `INSERT INTO friends (
       id, line_user_id, line_account_id, is_following, unfollow_count,
       last_followed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now', '+9 hours'), datetime('now', '+9 hours'), datetime('now', '+9 hours'))`,
  ).run(
    id,
    `U-${id}`,
    accountId,
    options.isFollowing ?? 1,
    options.unfollowCount ?? 0,
  );
}

describe('getFriendAddBreakdown', () => {
  test('D1の予約語を避け、選択中アカウントだけを集計する', async () => {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'test-token', 'test-secret')`,
    ).run('account-a', 'channel-a', 'アカウントA');
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'test-token', 'test-secret')`,
    ).run('account-b', 'channel-b', 'アカウントB');

    insertFriend('first', 'account-a');
    insertFriend('returning-following', 'account-a', { unfollowCount: 2 });
    insertFriend('returning-blocked', 'account-a', { unfollowCount: 1, isFollowing: 0 });
    insertFriend('other-account', 'account-b');

    await expect(getFriendAddBreakdown(db, 30, {
      allowedAccountIds: ['account-a'], includeUnassigned: false,
    })).resolves.toEqual({
      days: 30,
      firstTime: 1,
      returning: 2,
      unblocked: 1,
    });
  });
});
