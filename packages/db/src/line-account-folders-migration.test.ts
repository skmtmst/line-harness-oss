import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
it('608を移行前の表へ適用すると、1所属・未分類・統括境界・削除時の所属解除が守られる',()=>{
  const db=new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants VALUES('t'),('other');
      CREATE TABLE line_accounts(id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),archived_at TEXT);
      INSERT INTO line_accounts VALUES('zero','t',NULL),('one','t',NULL),('multi','t',NULL),('foreign','other',NULL);`);
    db.exec(readFileSync(new URL('../migrations/544_line_account_tags.sql',import.meta.url),'utf8'));
    db.exec(`INSERT INTO line_account_tags VALUES('a','t','A','#2f6fde',2,'now','now'),('b','t','B','#1f9d55',1,'now','now');
      INSERT INTO line_account_tag_links VALUES('one','a','t'),('multi','a','t'),('multi','b','t');`);
    db.exec(readFileSync(new URL('../migrations/608_line_account_folders.sql',import.meta.url),'utf8'));
    expect(db.prepare('SELECT id,folder_id FROM line_accounts ORDER BY id').all()).toEqual([{id:'foreign',folder_id:null},{id:'multi',folder_id:'b'},{id:'one',folder_id:'a'},{id:'zero',folder_id:null}]);
    expect(()=>db.prepare("UPDATE line_accounts SET folder_id='a' WHERE id='foreign'").run()).toThrow('ACCOUNT_FOLDER_SCOPE_INVALID');
    expect(()=>db.prepare("UPDATE line_accounts SET tenant_id='other' WHERE id='one'").run()).toThrow('ACCOUNT_FOLDER_SCOPE_INVALID');
    db.exec("DELETE FROM line_account_tags WHERE id='b'");
    expect(db.prepare("SELECT folder_id FROM line_accounts WHERE id='multi'").get()).toEqual({folder_id:null});
    expect(db.prepare('SELECT COUNT(*) AS n FROM line_accounts').get()).toEqual({n:4});
  } finally {db.close();}
});
