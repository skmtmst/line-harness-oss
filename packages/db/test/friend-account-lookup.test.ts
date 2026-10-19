import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getFriendByLineUserIdForAccount, upsertFriend } from '../src/friends/index.js';

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    async first<T>() {
      return (sqlite.prepare(sql).get(...params) as T) ?? null;
    },
    async run() {
      return { success: true, meta: sqlite.prepare(sql).run(...params) };
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
    CREATE TABLE line_accounts(id TEXT PRIMARY KEY, tenant_id TEXT);
    INSERT INTO line_accounts(id,tenant_id) VALUES ('account-a',NULL),('account-b',NULL);
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      line_user_id TEXT NOT NULL,
      display_name TEXT,
      picture_url TEXT,
      status_message TEXT,
      is_following INTEGER NOT NULL DEFAULT 1,
      first_followed_at TEXT,
      current_follow_started_at TEXT,
      last_followed_at TEXT,
      last_unfollowed_at TEXT,
      unfollow_count INTEGER NOT NULL DEFAULT 0,
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
  insert.run('friend-u', 'U-free', '未割当', null);
  db = asD1(sqlite);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('getFriendByLineUserIdForAccount', () => {
  test('指定アカウントの行を優先する', async () => {
    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-b');

    expect(friend?.id).toBe('friend-b');
  });

  test('他アカウント所有の行しか無い場合は null を返す（跨ぎフォールバック廃止）', async () => {
    // Issue #961: account-missing に該当者が無くても account-a/b の行を
    // 返してはいけない。返すと「friend=別アカウント・送信元=受信アカウント」の
    // 履歴が作られる。
    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-missing');

    expect(friend).toBeNull();
  });

  test('未割当 (line_account_id IS NULL) の行は指定アカウントの解決に含める', async () => {
    // 未割当は従来の既定統括の行。既定統括のアカウントだけが引き当てる。
    const friend = await getFriendByLineUserIdForAccount(db, 'U-free', 'account-a');

    expect(friend?.id).toBe('friend-u');
  });
  test('S15 another tenant cannot adopt an unassigned legacy friend or its private data', async () => {
    sqlite.prepare("UPDATE line_accounts SET tenant_id='foreign-tenant' WHERE id='account-b'").run();
    expect(await getFriendByLineUserIdForAccount(db, 'U-free', 'account-b')).toBeNull();
    expect((await getFriendByLineUserIdForAccount(db, 'U-free', 'account-a'))?.id).toBe('friend-u');
    expect((await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-b'))?.id).toBe('friend-b');
    expect(await getFriendByLineUserIdForAccount(db, 'U-free', 'unknown-account')).toBeNull();
  });

  test('SEC-04 lineAccountId 未指定では他店の行を返さない', async () => {
    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', null);

    expect(friend).toBeNull();
  });

  test('同一アカウントにも未割当にも無い場合は null を返す', async () => {
    const friend = await getFriendByLineUserIdForAccount(db, 'U-new', 'account-a');

    expect(friend).toBeNull();
  });
});

describe('upsertFriend', () => {
  test('新規作成時に指定したLINEアカウントを保存し、警告を出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const friend = await upsertFriend(db, {
      lineUserId: 'U-new-account',
      lineAccountId: 'account-a',
      displayName: '新規友だち',
    });

    expect(friend.line_account_id).toBe('account-a');
    expect(warn).not.toHaveBeenCalled();
  });

  test('LINEアカウントを渡さない新規作成は後方互換でNULLを保存する', async () => {
    const friend = await upsertFriend(db, {
      lineUserId: 'U-new-unassigned',
      displayName: '未割当友だち',
    });

    expect(friend.line_account_id).toBeNull();
  });
});
