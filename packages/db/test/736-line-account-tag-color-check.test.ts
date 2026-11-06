import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../migrations/736_line_account_tag_color_check.sql', import.meta.url), 'utf8');
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  db.pragma('foreign_keys = ON');
  db.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token)
    VALUES ('account','本店','channel','test','test');
    INSERT INTO line_account_tags(id,tenant_id,name,color,created_at,updated_at)
    VALUES ('folder','00000000-0000-4000-8000-000000000001','既存','#ec4899','2026-10-01','2026-10-01');
    UPDATE line_accounts SET folder_id='folder' WHERE id='account';
    INSERT INTO line_account_tag_links(line_account_id,tag_id,tenant_id)
    VALUES ('account','folder','00000000-0000-4000-8000-000000000001');`);
});
afterEach(() => db.close());

describe('736 アカウントフォルダの色制約', () => {
  it('既存の色と所属を保ち、新しい色を受け入れ不正な色を拒む', () => {
    const accountBefore = db.prepare("SELECT * FROM line_accounts WHERE id='account'").get();
    const tagBefore = db.prepare("SELECT * FROM line_account_tags WHERE id='folder'").get();
    const linkBefore = db.prepare('SELECT * FROM line_account_tag_links').all();

    db.exec(migration);

    expect(db.prepare("SELECT * FROM line_accounts WHERE id='account'").get()).toEqual(accountBefore);
    expect(db.prepare("SELECT * FROM line_account_tags WHERE id='folder'").get()).toEqual(tagBefore);
    expect(db.prepare('SELECT * FROM line_account_tag_links').all()).toEqual(linkBefore);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='line_account_tags'").get()).toMatchObject({
      sql: expect.stringContaining("substr(color,2) NOT GLOB '*[^0-9A-Fa-f]*'"),
    });
    db.prepare(`INSERT INTO line_account_tags(id,tenant_id,name,color,created_at,updated_at)
      VALUES ('new','00000000-0000-4000-8000-000000000001','新規',?,'2026-10-29','2026-10-29')`).run('#ec4899');
    expect(() => db.prepare("UPDATE line_account_tags SET color='#ec48z9' WHERE id='new'").run()).toThrow();
  });

  it('アーカイブ済みアカウントの旧タグリンクも失わない', () => {
    db.prepare("UPDATE line_accounts SET archived_at='2026-10-28' WHERE id='account'").run();
    db.exec(migration);
    expect(db.prepare('SELECT line_account_id,tag_id FROM line_account_tag_links').all()).toEqual([
      { line_account_id: 'account', tag_id: 'folder' },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
