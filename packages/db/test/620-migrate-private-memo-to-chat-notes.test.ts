import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../migrations/620_migrate_private_memo_to_chat_notes.sql', import.meta.url), 'utf8');
const migrated = (memo: string) => `【旧「個別メモ」から移行】\n${memo}\n【移行したメモここまで】`;
let raw: Database.Database;

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('store','channel','店舗','test','test');
    INSERT INTO friends(id,line_user_id,line_account_id,private_memo) VALUES
      ('existing','u1','store','旧メモ\n2行目'), ('new','u2','store','会話のない人のメモ'),
      ('null-note','u3','store','空の受信箱へ'), ('same','u4','store','同じ内容'),
      ('blank','u5','store',char(9)||char(10)||' '), ('none','u6','store',NULL),
      ('spaces','u7','store','  前後の空白も残す  ');
    INSERT INTO chats(id,friend_id,line_account_id,notes,status,revision,last_message_at,created_at,updated_at)
    VALUES ('c1','existing','store','受信箱の既存メモ','resolved',7,'2026-10-08','2026-10-01','2026-10-08'),
      ('c3','null-note','store',NULL,'on_hold',2,NULL,'2026-10-01','2026-10-08'),
      ('c4','same','store','同じ内容','in_progress',3,NULL,'2026-10-01','2026-10-08');`);
});
afterEach(() => raw.close());
const chat = (friendId: string) => raw.prepare('SELECT * FROM chats WHERE friend_id=?').get(friendId) as Record<string, unknown> | undefined;

describe('620 既存メモを受信箱へ移す', () => {
  it('既存メモを残し、区切り・出どころつきで追記する（所属・対応状態・受信日時を保持）', () => {
    const before = chat('existing')!;
    const schema = raw.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
    raw.exec(migration);
    const { notes, updated_at, revision, ...rest } = chat('existing')!;
    expect(notes).toBe(`受信箱の既存メモ\n\n──────────\n${migrated('旧メモ\n2行目')}`);
    expect(revision).toBe(8);
    expect(updated_at).not.toBe(before.updated_at);
    const { notes: _notes, updated_at: _updated, revision: _revision, ...beforeRest } = before;
    expect(rest).toEqual(beforeRest);
    expect(raw.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(raw.prepare('SELECT private_memo FROM friends WHERE id=?').get('existing')).toEqual({ private_memo: '旧メモ\n2行目' });
  });

  it('会話なし・メモなしにも移し、空の旧メモでは会話を作らない', () => {
    raw.exec(migration);
    expect(chat('new')).toMatchObject({ line_account_id: 'store', notes: migrated('会話のない人のメモ') });
    expect(chat('null-note')?.notes).toBe(migrated('空の受信箱へ'));
    expect(chat('spaces')?.notes).toBe(migrated('  前後の空白も残す  '));
    expect(chat('blank')).toBeUndefined();
    expect(chat('none')).toBeUndefined();
    expect(raw.pragma('foreign_key_check')).toEqual([]);
  });

  it('同じ内容が両方にある場合も本文を二重にしない', () => {
    raw.exec(migration);
    expect(chat('same')?.notes).toBe(migrated('同じ内容'));
  });

  it('2回適用しても本文・会話ID・更新日時・版が変わらず、後から足したメモも残る', () => {
    raw.exec(migration);
    raw.prepare("UPDATE chats SET notes=notes||char(10)||'移行後の追記' WHERE friend_id='existing'").run();
    const first = raw.prepare('SELECT * FROM chats ORDER BY friend_id').all();
    raw.exec(migration);
    expect(raw.prepare('SELECT * FROM chats ORDER BY friend_id').all()).toEqual(first);
  });
});
