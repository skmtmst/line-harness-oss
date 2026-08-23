import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getFriendByLineUserIdForAccount } from '../src/friends.js';

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    async first<T>() {
      return (sqlite.prepare(sql).get(...params) as T) ?? null;
    },
  });
  return {
    prepare(sql: string) {
      return { bind: (...params: unknown[]) => wrap(sql, params), ...wrap(sql, []) };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      line_user_id TEXT NOT NULL,
      display_name TEXT,
      picture_url TEXT,
      status_message TEXT,
      is_following INTEGER NOT NULL DEFAULT 1,
      user_id TEXT,
      line_account_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      first_tracked_link_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    `INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')`,
  );
  insert.run('friend-a', 'U-shared', '店舗A', 'account-a');
  insert.run('friend-b', 'U-shared', '店舗B', 'account-b');
  db = asD1(sqlite);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('getFriendByLineUserIdForAccount', () => {
  test('指定アカウントの行を優先し、警告を出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-b');

    expect(friend?.id).toBe('friend-b');
    expect(warn).not.toHaveBeenCalled();
  });

  test('指定アカウントに無い場合は従来検索へフォールバックし、安全な警告だけを出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-missing');

    expect(friend?.id).toBe('friend-a');
    expect(warn).toHaveBeenCalledWith({
      event: 'friend_lookup_account_fallback',
      line_account_id: 'account-missing',
      path: 'getFriendByLineUserIdForAccount',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('U-shared');
  });
});
