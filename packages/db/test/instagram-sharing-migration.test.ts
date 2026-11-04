import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

it('754 は既存の接続と受信履歴を残し、同じ統括だけ共有できる', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE line_accounts(id TEXT PRIMARY KEY, tenant_id TEXT);
      INSERT INTO line_accounts VALUES('a1','t1'),('a2','t1'),('a3','t2');
      CREATE TABLE instagram_connections (
        line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), page_id TEXT NOT NULL,
        instagram_id TEXT NOT NULL UNIQUE, page_name TEXT NOT NULL, username TEXT,
        page_token_encrypted TEXT NOT NULL, user_token_encrypted TEXT NOT NULL,
        expires_at TEXT NOT NULL, data_access_expires_at TEXT, profile_json TEXT, posts_json TEXT,
        refreshed_at TEXT NOT NULL, synced_at TEXT, connected_by TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, scopes TEXT NOT NULL DEFAULT '');
      CREATE TABLE instagram_messages (
        id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
        instagram_id TEXT NOT NULL, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
        content TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachments_json)),
        received_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(line_account_id,id));
      CREATE INDEX idx_instagram_messages_account_time ON instagram_messages(line_account_id,received_at,id);
      INSERT INTO instagram_connections(line_account_id,page_id,instagram_id,page_name,page_token_encrypted,user_token_encrypted,expires_at,refreshed_at,connected_by)
      VALUES('a1','ig1','ig1','existing','cipher1','cipher2','2030-01-01','2026-01-01','staff');
      INSERT INTO instagram_messages(id,line_account_id,instagram_id,sender_id,recipient_id,content,received_at,created_at)
      VALUES('message1','a1','ig1','customer','ig1','existing message','2026-01-01','2026-01-01');
    `);
    const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '754_instagram_shared_within_tenant.sql'), 'utf8');
    db.exec(migration);
    const connection = db.prepare('SELECT line_account_id,instagram_id,page_token_encrypted,scopes FROM instagram_connections').get();
    expect(connection).toEqual({ line_account_id: 'a1', instagram_id: 'ig1', page_token_encrypted: 'cipher1', scopes: '' });
    expect(db.prepare('SELECT content FROM instagram_messages WHERE line_account_id=?').get('a1')).toEqual({ content: 'existing message' });
    const add = db.prepare(`INSERT INTO instagram_connections(line_account_id,page_id,instagram_id,page_name,page_token_encrypted,user_token_encrypted,expires_at,refreshed_at,connected_by)
      VALUES(?,?,?,'shared','cipher1','cipher2','2030-01-01','2026-01-01','staff')`);
    add.run('a2', 'ig1', 'ig1');
    expect(() => add.run('a3', 'ig1', 'ig1')).toThrow('instagram_cross_tenant');
    db.prepare(`INSERT INTO instagram_messages(id,line_account_id,instagram_id,sender_id,recipient_id,content,received_at,created_at)
      VALUES('message1','a2','ig1','customer','ig1','shared message','2026-01-01','2026-01-01')`).run();
    expect(db.prepare('SELECT COUNT(*) n FROM instagram_messages WHERE id=?').get('message1')).toEqual({ n: 2 });
  } finally {
    db.close();
  }
});
