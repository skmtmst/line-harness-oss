import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  getFriendByLineUserIdForAccount,
  isFriendLineUserIdConflict,
  updateFriendFollowStatus,
  upsertFriend,
} from '../src/friends.js';

/**
 * Issue #961: 同一 LINE user ID が複数アカウントに存在するとき、
 * アカウントAの解決がアカウントBの friend 行を返したり、Bの行を
 * Aへ「移動」したりしてはいけない。
 *
 * 現行スキーマは line_user_id がグローバル UNIQUE で1ユーザー1行しか
 * 持てない（複合一意制約への移行は C-2b）。その制約の下で:
 * - 別アカウント所有の行は解決・更新・移動の対象にしない
 * - 未割当 (NULL) の行だけは、受信したアカウントへ明示的に引き当てる
 */

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

const FRIENDS_COLUMNS = `
  id TEXT PRIMARY KEY,
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
`;

const databases: Database.Database[] = [];

function makeDb(opts: { globalUniqueLineUserId: boolean }) {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  const lineUserIdColumn = opts.globalUniqueLineUserId
    ? 'line_user_id TEXT NOT NULL UNIQUE'
    : 'line_user_id TEXT NOT NULL';
  sqlite.exec(`CREATE TABLE friends (${lineUserIdColumn}, ${FRIENDS_COLUMNS});`);
  return { sqlite, db: asD1(sqlite) };
}

function insertFriend(
  sqlite: Database.Database,
  row: { id: string; lineUserId: string; accountId: string | null; displayName?: string },
) {
  sqlite
    .prepare(
      `INSERT INTO friends
        (id, line_user_id, display_name, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')`,
    )
    .run(row.id, row.lineUserId, row.displayName ?? row.id, row.accountId);
}

function friendRow(sqlite: Database.Database, id: string) {
  return sqlite.prepare('SELECT * FROM friends WHERE id = ?').get(id) as {
    id: string;
    line_account_id: string | null;
    is_following: number;
    display_name: string | null;
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('現行スキーマ (line_user_id グローバルUNIQUE) でのスコープ分離', () => {
  test('アカウントB所有の行はアカウントAの解決で返さない', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: true });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    const friend = await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-a');

    expect(friend).toBeNull();
    expect(friendRow(sqlite, 'friend-b').line_account_id).toBe('account-b');
  });

  test('アカウントB所有の行があるとき、アカウントAの upsertFriend は競合で失敗しBの行を変えない', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: true });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    // C-2b の複合一意制約が無いうちは A 用の行を作れない。失敗が呼出側へ
    // 返ることで「friend=B・送信元=A」の履歴が作られない。
    const error = await upsertFriend(db, {
      lineUserId: 'U-shared',
      lineAccountId: 'account-a',
      displayName: '乗っ取り名',
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).not.toBeNull();
    expect(isFriendLineUserIdConflict(error)).toBe(true);

    const row = friendRow(sqlite, 'friend-b');
    expect(row.line_account_id).toBe('account-b');
    expect(row.display_name).toBe('friend-b');
    expect(row.is_following).toBe(1);
    expect(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM friends').get() as { c: number }).c,
    ).toBe(1);
  });

  test('アカウントB所有の行への unfollow (アカウントA受信) はBの行を変えない', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: true });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    await updateFriendFollowStatus(db, 'U-shared', false, 'account-a');

    expect(friendRow(sqlite, 'friend-b').is_following).toBe(1);
  });

  test('未割当の行は upsertFriend が受信アカウントへ引き当てる', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: true });
    insertFriend(sqlite, { id: 'friend-u', lineUserId: 'U-free', accountId: null });

    const friend = await upsertFriend(db, {
      lineUserId: 'U-free',
      lineAccountId: 'account-a',
      displayName: '未割当だった人',
    });

    expect(friend.id).toBe('friend-u');
    expect(friend.line_account_id).toBe('account-a');
    expect(
      (sqlite.prepare('SELECT COUNT(*) AS c FROM friends').get() as { c: number }).c,
    ).toBe(1);
  });
});

describe('同一 line_user_id の行がアカウントごとに並存する場合 (C-2b後の形)', () => {
  test('AとBそれぞれの行が独立して解決される', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: false });
    insertFriend(sqlite, { id: 'friend-a', lineUserId: 'U-shared', accountId: 'account-a' });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    expect((await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-a'))?.id).toBe('friend-a');
    expect((await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-b'))?.id).toBe('friend-b');
    expect(await getFriendByLineUserIdForAccount(db, 'U-shared', 'account-c')).toBeNull();
  });

  test('upsertFriend は自分のアカウントの行だけを更新する', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: false });
    insertFriend(sqlite, { id: 'friend-a', lineUserId: 'U-shared', accountId: 'account-a' });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    const updated = await upsertFriend(db, {
      lineUserId: 'U-shared',
      lineAccountId: 'account-a',
      displayName: 'A経由の名前',
    });

    expect(updated.id).toBe('friend-a');
    expect(friendRow(sqlite, 'friend-a').display_name).toBe('A経由の名前');
    expect(friendRow(sqlite, 'friend-b').display_name).toBe('friend-b');
    expect(friendRow(sqlite, 'friend-b').line_account_id).toBe('account-b');
  });

  test('unfollow も自分のアカウントの行だけに効く', async () => {
    const { sqlite, db } = makeDb({ globalUniqueLineUserId: false });
    insertFriend(sqlite, { id: 'friend-a', lineUserId: 'U-shared', accountId: 'account-a' });
    insertFriend(sqlite, { id: 'friend-b', lineUserId: 'U-shared', accountId: 'account-b' });

    await updateFriendFollowStatus(db, 'U-shared', false, 'account-a');

    expect(friendRow(sqlite, 'friend-a').is_following).toBe(0);
    expect(friendRow(sqlite, 'friend-b').is_following).toBe(1);
  });
});
