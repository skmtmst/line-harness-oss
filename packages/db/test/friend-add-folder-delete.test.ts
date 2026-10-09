import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { deleteFriendAddRuleFolder } from '../src/friend-add-rules.js';

let raw: Database.Database, db: D1Database, directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friend-add-folder-'));
  raw = new Database(join(directory, 'test.sqlite'));
  raw.pragma('journal_mode = WAL');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token)
    VALUES('a','店A','a','fixture','fixture'),('b','店B','b','fixture','fixture');
    INSERT INTO friend_add_rule_folders(id,line_account_id,name,color,create_idempotency_key,created_by_staff_id,created_at,updated_at)
    VALUES('folder','a','店頭','#16a34a','key-a','actor','now','now'),('other','b','店頭',NULL,'key-b','actor','now','now');
    INSERT INTO friend_add_rules(id,line_account_id,friend_kind,name,folder_name,priority,status)
    VALUES('first','a','first_time','初回','店頭',1,'published'),('return','a','returning','再追加','店頭',2,'stopped'),
    ('archive','a','first_time','過去','店頭',3,'archived'),('unfiled','a','first_time','未分類',NULL,4,'draft'),
    ('foreign','b','first_time','他店','店頭',1,'draft');
    INSERT INTO friend_add_rule_versions(id,rule_id,version_number,definition_snapshot,status)
    VALUES('v','first',1,'{"messageText":"案内"}','published');`);
  db = asD1(raw);
});
afterEach(() => { raw.close(); rmSync(directory, { recursive: true, force: true }); });
const input = { lineAccountId: 'a', folderId: 'folder' };
function rules() { return raw.prepare('SELECT id,folder_name,lock_version,status FROM friend_add_rules ORDER BY id').all(); }

it('初回・再追加・過去の設定を未分類へ戻し、公開版と他店の同名フォルダは残す', async () => {
  const versions = raw.prepare('SELECT * FROM friend_add_rule_versions').all();
  expect(await deleteFriendAddRuleFolder(db, input)).toBe('deleted');
  expect(raw.prepare('SELECT id FROM friend_add_rule_folders ORDER BY id').all()).toEqual([{ id: 'other' }]);
  expect(rules()).toEqual([
    { id: 'archive', folder_name: null, lock_version: 2, status: 'archived' },
    { id: 'first', folder_name: null, lock_version: 2, status: 'published' },
    { id: 'foreign', folder_name: '店頭', lock_version: 1, status: 'draft' },
    { id: 'return', folder_name: null, lock_version: 2, status: 'stopped' },
    { id: 'unfiled', folder_name: null, lock_version: 1, status: 'draft' },
  ]);
  expect(raw.prepare('SELECT * FROM friend_add_rule_versions').all()).toEqual(versions);
  expect(await deleteFriendAddRuleFolder(db, input)).toBe('not_found');
});

it('他店と存在しないフォルダは変更しない', async () => {
  const before = rules();
  expect(await deleteFriendAddRuleFolder(db, { ...input, folderId: 'other' })).toBe('not_found');
  expect(await deleteFriendAddRuleFolder(db, { ...input, folderId: 'missing' })).toBe('not_found');
  expect(rules()).toEqual(before);
});

it.each([
  "UPDATE friend_add_rule_folders SET name='改名' WHERE id='folder'",
  "UPDATE friend_add_rule_folders SET color='#ef4444' WHERE id='folder'",
  "UPDATE friend_add_rule_folders SET updated_at='later' WHERE id='folder'",
  "DELETE FROM friend_add_rule_folders WHERE id='folder'",
])('独立した接続が読み取り後に変更したとき、競合を返して設定を触らない: %s', async (sql) => {
  const before = rules();
  const other = new Database(join(directory, 'test.sqlite'));
  try {
    const competing = { prepare: db.prepare, batch: (statements: D1PreparedStatement[]) => {
      other.exec(sql);
      return db.batch(statements);
    } } as D1Database;
    expect(await deleteFriendAddRuleFolder(competing, input)).toBe('conflict');
    expect(rules()).toEqual(before);
  } finally { other.close(); }
});

it('最後の削除が失敗したら、未分類への変更と設定の版の更新も戻す', async () => {
  const before = rules();
  raw.exec("CREATE TRIGGER reject_folder_delete BEFORE DELETE ON friend_add_rule_folders BEGIN SELECT RAISE(ABORT,'test_delete_failure'); END;");
  await expect(deleteFriendAddRuleFolder(db, input)).rejects.toThrow('test_delete_failure');
  expect(rules()).toEqual(before);
  expect(raw.prepare("SELECT id FROM friend_add_rule_folders WHERE id='folder'").get()).toEqual({ id: 'folder' });
});
