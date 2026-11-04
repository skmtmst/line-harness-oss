import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('過去分は作らず、手動の返事ごとに担当と当時の期限を顧客情報なしで残す',()=>{
 const raw=new Database(':memory:');
 try {
  raw.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
  raw.exec(`INSERT INTO tenants(id,name) VALUES('t','店');
   INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t','c','店','x','x');
   INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('s','担当','staff','key','t');
   INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','user','a');
   INSERT INTO chats(id,friend_id,status,last_customer_message_at,assignee_staff_id,created_at,updated_at) VALUES('c','f','unread','2026-11-05T00:00:00Z','s','now','now');
   UPDATE chats SET sla_due_at='2026-11-05T00:30:00Z' WHERE id='c';`);
  expect(raw.prepare('SELECT count(*) n FROM inbox_response_samples').get()).toEqual({n:0});
  raw.exec("UPDATE chats SET last_operator_message_at='2026-11-05T00:20:00Z' WHERE id='c'");
  raw.exec("UPDATE chats SET last_operator_message_at='2026-11-05T00:21:00Z' WHERE id='c'");
  expect(raw.prepare('SELECT account_id,staff_id,pending_since,due_at,responded_at,is_first_response FROM inbox_response_samples ORDER BY responded_at').all()).toEqual([
   {account_id:'a',staff_id:'s',pending_since:'2026-11-05T00:00:00Z',due_at:'2026-11-05T00:30:00Z',responded_at:'2026-11-05T00:20:00Z',is_first_response:1},
   {account_id:'a',staff_id:'s',pending_since:null,due_at:null,responded_at:'2026-11-05T00:21:00Z',is_first_response:0},
  ]);
  raw.exec("INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES('m','f','outgoing','text','private text','auto_reply','2026-11-05T00:22:00Z')");
  expect(raw.prepare("SELECT reply_kind,staff_id,due_at,is_first_response FROM inbox_response_samples WHERE reply_kind='automatic'").get()).toEqual({reply_kind:'automatic',staff_id:null,due_at:null,is_first_response:0});
  expect((raw.prepare('PRAGMA table_info(inbox_response_samples)').all() as Array<{name:string}>).map(x=>x.name)).not.toContain('friend_id');
  expect((raw.prepare('PRAGMA table_info(inbox_response_samples)').all() as Array<{name:string}>).map(x=>x.name)).toContain('chat_id');
 } finally {raw.close()}
});

it('既存の会話を変えずに追加し、過去の返事を作り直さない',()=>{
 const raw=new Database(':memory:');
 try {
  raw.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY); CREATE TABLE staff_members(id TEXT PRIMARY KEY);
   CREATE TABLE friends(id TEXT PRIMARY KEY,line_account_id TEXT); CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,direction TEXT,source TEXT,created_at TEXT); CREATE TABLE chats(id TEXT PRIMARY KEY,friend_id TEXT,assignee_staff_id TEXT,pending_since TEXT,first_response_at TEXT,sla_due_at TEXT,last_operator_message_at TEXT);
   INSERT INTO line_accounts VALUES('a'); INSERT INTO friends VALUES('f','a');
   INSERT INTO chats VALUES('c','f',NULL,'2026-10-01T00:00:00Z','2026-10-01T00:10:00Z',NULL,'2026-10-01T00:10:00Z');`);
  raw.exec(readFileSync(new URL('../migrations/763_inbox_response_samples.sql',import.meta.url),'utf8'));
  expect(raw.prepare('SELECT id,first_response_at FROM chats').get()).toEqual({id:'c',first_response_at:'2026-10-01T00:10:00Z'});
  expect(raw.prepare('SELECT count(*) n FROM inbox_response_samples').get()).toEqual({n:0});
 } finally {raw.close()}
});


it('会話削除時は週単位の匿名の件数だけ残し、担当者と店の削除にも追随する',()=>{
 const raw=new Database(':memory:');
 try {
  raw.pragma('foreign_keys = ON');
  raw.exec(`CREATE TABLE line_accounts(id TEXT PRIMARY KEY); CREATE TABLE staff_members(id TEXT PRIMARY KEY);
   CREATE TABLE friends(id TEXT PRIMARY KEY,line_account_id TEXT); CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,direction TEXT,source TEXT,created_at TEXT); CREATE TABLE chats(id TEXT PRIMARY KEY,friend_id TEXT,assignee_staff_id TEXT,pending_since TEXT,first_response_at TEXT,sla_due_at TEXT,last_operator_message_at TEXT);
   INSERT INTO line_accounts VALUES('a'); INSERT INTO staff_members VALUES('s'),('s2'); INSERT INTO chats(id) VALUES('c'),('c2');`);
  raw.exec(readFileSync(new URL('../migrations/763_inbox_response_samples.sql',import.meta.url),'utf8'));
  raw.exec(`INSERT INTO inbox_response_samples(id,account_id,chat_id,staff_id,pending_since,due_at,responded_at,is_first_response) VALUES
   ('1','a','c','s','2026-11-05T00:00:00Z','2026-11-05T00:15:00Z','2026-11-05T00:10:00Z',1),
   ('2','a','c','s','2026-11-05T00:00:00Z','2026-11-05T00:15:00Z','2026-11-05T00:20:00Z',1),
   ('3','a','c2','s2','2026-11-05T00:00:00Z',NULL,'2026-11-05T00:20:00Z',1);
   INSERT INTO inbox_response_samples(id,account_id,chat_id,reply_kind,responded_at,is_first_response) VALUES('auto','a','c2','automatic','2026-11-05T00:22:00Z',0); DELETE FROM chats WHERE id IN ('c','c2');`);
  expect(raw.prepare('SELECT count(*) n FROM inbox_response_samples').get()).toEqual({n:0});
  expect(raw.prepare('SELECT week,on_time,overdue,no_deadline FROM inbox_response_deleted_weekly WHERE staff_id=?').get('s')).toEqual({week:'2026-11-02',on_time:1,overdue:1,no_deadline:0});
  raw.exec("DELETE FROM staff_members WHERE id IN ('s','s2')");
  expect(raw.prepare('SELECT staff_id,staff_deleted,on_time,overdue,no_deadline FROM inbox_response_deleted_weekly WHERE staff_deleted=1').all()).toEqual([{staff_id:null,staff_deleted:1,on_time:1,overdue:1,no_deadline:1}]);
  expect(raw.prepare('SELECT automatic FROM inbox_response_deleted_weekly WHERE staff_deleted=0 AND staff_id IS NULL').get()).toEqual({automatic:1});
  expect((raw.prepare('PRAGMA table_info(inbox_response_deleted_weekly)').all() as Array<{name:string}>).map(x=>x.name)).toEqual(['account_id','staff_id','staff_deleted','week','on_time','overdue','no_deadline','automatic']);
  raw.exec(`INSERT INTO chats(id) VALUES('c3'); INSERT INTO inbox_response_samples(id,account_id,chat_id,responded_at,is_first_response) VALUES('4','a','c3','2026-11-05T00:20:00Z',1); DELETE FROM line_accounts WHERE id='a'`);
  expect(raw.prepare('SELECT count(*) n FROM inbox_response_deleted_weekly').get()).toEqual({n:0});
  expect(raw.prepare('SELECT count(*) n FROM inbox_response_samples').get()).toEqual({n:0});
 } finally {raw.close()}
});
