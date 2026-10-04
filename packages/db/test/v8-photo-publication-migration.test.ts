import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('578のSQLが完結し、既存の掲載に追加報酬を遡及しない', () => {
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE nen_photo_publications(id TEXT PRIMARY KEY,photo_id TEXT,line_account_id TEXT,status TEXT);
      CREATE TABLE photo_reward_policies(policy_key TEXT,version_number INTEGER,points INTEGER,effective_from TEXT);
      CREATE TABLE nen_photo_submissions(id TEXT PRIMARY KEY,line_account_id TEXT,friend_id TEXT,status TEXT,publication_consent_at TEXT,publication_withdrawn_at TEXT);
      CREATE TABLE friends(id TEXT PRIMARY KEY,line_account_id TEXT);
      CREATE TABLE nen_ec_member_snapshots(friend_id TEXT,customer_id TEXT);
      CREATE TABLE line_accounts(id TEXT PRIMARY KEY); INSERT INTO line_accounts VALUES('a');
      INSERT INTO photo_reward_policies VALUES('v1',1,5,NULL);
      INSERT INTO friends VALUES('f','a'); INSERT INTO nen_ec_member_snapshots VALUES('f','123');
      INSERT INTO nen_photo_submissions VALUES('old','a','f','pending','2026-10-01',NULL);
      INSERT INTO nen_photo_publications VALUES('pub-old','old','a','published');`);
    db.exec(readFileSync(new URL('../migrations/578_v8_photo_publication_rewards.sql',import.meta.url),'utf8'));
    db.exec("UPDATE photo_reward_policies SET publication_points=200; UPDATE nen_photo_submissions SET status='adopted' WHERE id='old'; UPDATE nen_photo_publications SET status='withdrawn'; UPDATE nen_photo_publications SET status='published'");
    expect(db.prepare('SELECT * FROM nen_photo_publication_reward_outbox').all()).toEqual([]);
    expect(db.prepare('SELECT reward_policy_key,reward_points,sort_order FROM nen_photo_publications').get()).toEqual({reward_policy_key:null,reward_points:null,sort_order:0});
    db.exec("INSERT INTO nen_photo_submissions VALUES('new','a','f','adopted','2026-10-01',NULL); INSERT INTO nen_photo_publications (id,photo_id,line_account_id,status) VALUES('pub-new','new','a','published')");
    expect(db.prepare('SELECT photo_id,points,policy_version FROM nen_photo_publication_reward_outbox').all()).toEqual([{photo_id:'new',points:200,policy_version:'v1'}]);
    expect(() => db.exec('UPDATE photo_reward_policies SET publication_points=-1')).toThrow(/CHECK/);
    expect(() => db.exec('UPDATE photo_reward_policies SET publication_points=100001')).toThrow(/CHECK/);
  } finally { db.close(); }
});
