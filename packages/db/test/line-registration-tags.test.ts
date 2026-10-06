import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { attachLineAccountRegistrationTags } from '../src/line-account-tags.js';
it('登録前タグは同じ統括だけを原子的に関連付け、版を変えない',async()=>{
 const raw=new Database(':memory:');
 try {
  raw.exec(`PRAGMA foreign_keys=ON; CREATE TABLE line_accounts(id TEXT PRIMARY KEY,revision INTEGER); CREATE TABLE line_account_tags(id TEXT,tenant_id TEXT,UNIQUE(id,tenant_id)); CREATE TABLE line_account_tag_links(line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,tag_id TEXT,tenant_id TEXT,PRIMARY KEY(line_account_id,tag_id),FOREIGN KEY(tag_id,tenant_id) REFERENCES line_account_tags(id,tenant_id));
   INSERT INTO line_accounts VALUES('a',1); INSERT INTO line_account_tags VALUES('own','t'),('other','u');`);
  await expect(attachLineAccountRegistrationTags(asD1(raw),'t','a',['own','other'])).rejects.toThrow();
  expect(raw.prepare('SELECT * FROM line_account_tag_links').all()).toEqual([]);
  await attachLineAccountRegistrationTags(asD1(raw),'t','a',['own']);
  expect(raw.prepare('SELECT * FROM line_account_tag_links').all()).toEqual([{line_account_id:'a',tag_id:'own',tenant_id:'t'}]);
  expect(raw.prepare('SELECT revision FROM line_accounts').get()).toEqual({revision:1});
  raw.exec("DELETE FROM line_accounts WHERE id='a'"); expect(raw.prepare('SELECT * FROM line_account_tag_links').all()).toEqual([]);
 } finally {raw.close();}
});
