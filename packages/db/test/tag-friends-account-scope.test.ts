import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getFriendsByTag, getFriendTagsByFriendIds } from '../src/tags.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '店舗1', 'token', 'secret'),
            ('account-2', 'channel-2', '店舗2', 'token', 'secret')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
     VALUES ('friend-1', 'user-1', '一郎', 'account-1'),
            ('friend-2', 'user-2', '二郎', 'account-2')`,
  ).run();
  sqlite.prepare("INSERT INTO tags (id, name) VALUES ('tag-1', '対象')").run();
  sqlite.prepare(
    `INSERT INTO friend_tags (friend_id, tag_id)
     VALUES ('friend-1', 'tag-1'), ('friend-2', 'tag-1')`,
  ).run();
  db = asD1(sqlite);
});

afterEach(() => sqlite?.close());

describe('タグの友だち取得', () => {
  it('配信元と別のLINEアカウントの友だちを混ぜない', async () => {
    const friends = await getFriendsByTag(db, 'tag-1', 'account-1');
    expect(friends.map((friend) => friend.id)).toEqual(['friend-1']);
  });

  it('アカウントを指定しない既存の利用方法は保つ', async () => {
    const friends = await getFriendsByTag(db, 'tag-1');
    expect(friends.map((friend) => friend.id).sort()).toEqual(['friend-1', 'friend-2']);
  });

  it.each([false, true])('指定した範囲だけを入力にし未割当の可否=%sを保つ', async (canSeeUnassigned) => {
    sqlite.prepare("INSERT INTO friends (id, line_user_id, display_name) VALUES ('unassigned', 'user-null', '未割当')").run();
    sqlite.prepare("INSERT INTO friend_tags (friend_id, tag_id) VALUES ('unassigned', 'tag-1')").run();
    const friends = await getFriendsByTag(db, 'tag-1', null, { allowedAccountIds: ['account-1'], canSeeUnassigned });
    expect(friends.map(friend => friend.id).sort()).toEqual(canSeeUnassigned ? ['friend-1', 'unassigned'] : ['friend-1']);
  });

  it('空の範囲は他アカウントへ広げず誰も返さない', async () => {
    expect(await getFriendsByTag(db, 'tag-1', undefined, { allowedAccountIds: [], canSeeUnassigned: false })).toEqual([]);
  });

  it('明示アカウントと範囲を両方満たさなければ返さない', async () => {
    expect(await getFriendsByTag(db, 'tag-1', 'account-2', { allowedAccountIds: ['account-1'], canSeeUnassigned: true })).toEqual([]);
  });

  it('明示アカウントでは未割当の許可があっても未割当を含めない', async () => {
    sqlite.prepare("INSERT INTO friends(id,line_user_id) VALUES ('unassigned','user-null')").run();
    sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES ('unassigned','tag-1')").run();
    expect((await getFriendsByTag(db, 'tag-1', 'account-1', { allowedAccountIds: ['account-1'], canSeeUnassigned: true })).map(friend=>friend.id)).toEqual(['friend-1']);
  });

  it('多数のアカウントも1バインドの集合で絞り順序を保つ', async () => {
    const allowedAccountIds = ['account-1', ...Array.from({ length: 200 }, (_, index) => `unused-${index}`)];
    sqlite.prepare("UPDATE friends SET created_at = '2030-01-01' WHERE id = 'friend-1'").run();
    sqlite.prepare("INSERT INTO friends(id,line_user_id,line_account_id,created_at) VALUES ('older','older-user','account-1','2020-01-01')").run();
    sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES ('older','tag-1')").run();
    const friends = await getFriendsByTag(db, 'tag-1', undefined, { allowedAccountIds, canSeeUnassigned: false });
    expect(friends.map(friend => friend.id)).toEqual(['friend-1', 'older']);
    expect(friends).toEqual(await getFriendsByTag(db, 'tag-1', 'account-1'));
  });

  it('200人のタグを1問い合わせ・1バインドで取得する', async () => {
    const insertFriend = sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES (?, ?, ?, 'account-1')`,
    );
    sqlite.transaction(() => {
      for (let index = 0; index < 200; index += 1) {
        insertFriend.run(`batch-${index}`, `batch-user-${index}`, `一括${index}`);
      }
      sqlite.prepare(
        `INSERT INTO friend_tags (friend_id, tag_id) VALUES ('batch-0', 'tag-1')`,
      ).run();
    })();
    const ids = Array.from({ length: 200 }, (_, index) => `batch-${index}`);
    let queryCount = 0;
    let bindCount = 0;
    const measuredDb = {
      ...db,
      prepare(query: string) {
        queryCount += 1;
        const statement = db.prepare(query);
        return {
          ...statement,
          bind(...values: unknown[]) {
            bindCount += values.length;
            return statement.bind(...values);
          },
        } as D1PreparedStatement;
      },
    } as D1Database;

    const tags = await getFriendTagsByFriendIds(measuredDb, ids);

    expect(queryCount).toBe(1);
    expect(bindCount).toBe(1);
    expect(tags.get('batch-0')?.map((tag) => tag.id)).toEqual(['tag-1']);
    expect(tags.has('batch-199')).toBe(false);
  });
});
