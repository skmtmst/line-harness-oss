import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { checkMigration } from '../../../scripts/check-migrations.js';
const sql=readFileSync(new URL('../migrations/595_imagemap_message_kinds.sql',import.meta.url),'utf8');
describe('595の配信種類追加（外部キー有効）',()=>{
 it('履歴・参照を残し、新しい種類を保存できる',()=>{
  const db=new Database(':memory:');
  db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8').replaceAll(", 'imagemap', 'rich_message', 'coupon'",''));
  db.pragma('foreign_keys=ON');
  db.exec(`INSERT INTO friends(id,line_user_id) VALUES('f','u');
   INSERT INTO scenarios(id,name,trigger_type) VALUES('s','試験','manual');
   INSERT INTO scenario_steps(id,scenario_id,step_order,message_type,message_content) VALUES('step','s',1,'text','本文');
   INSERT INTO templates(id,name,message_type,message_content) VALUES('t','試験','text','本文');
   UPDATE scenario_steps SET template_id='t' WHERE id='step';
   INSERT INTO template_versions(id,template_id,version_number,message_type,message_content) VALUES('tv','t',1,'text','公開版');
   INSERT INTO template_references(template_id,consumer_kind,consumer_id) VALUES('t','scenario','s');
   INSERT INTO template_publish_keys(template_id,idempotency_key,published_version,draft_revision,created_at) VALUES('t','key',1,1,'2026-10-07');
   INSERT INTO auto_replies(id,keyword,response_type,response_content,template_id) VALUES('r','予約','text','本文','t');
   INSERT INTO broadcasts(id,title,message_type,message_content) VALUES('b','試験','text','本文');
   INSERT INTO scenario_actions(id,scenario_id,step_id,hook,action_type,config_json) VALUES('action','s','step','step_sent','tag','{}');
   INSERT INTO scenario_action_fires(action_id,friend_id) VALUES('action','f');
   INSERT INTO broadcast_send_claims(broadcast_id,friend_id,state) VALUES('b','f','claimed');
   INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,scenario_step_id) VALUES('log','f','outgoing','text','本文','b','step');`);
  expect(()=>db.prepare("UPDATE templates SET message_type='imagemap'").run()).toThrow('CHECK');
  db.transaction(()=>db.exec(sql))();
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(db.prepare('SELECT broadcast_id,scenario_step_id FROM messages_log WHERE id=?').get('log')).toEqual({broadcast_id:'b',scenario_step_id:'step'});
  expect(db.prepare('SELECT template_id FROM scenario_steps').get()).toEqual({template_id:'t'});
  expect(db.prepare('SELECT template_id FROM auto_replies').get()).toEqual({template_id:'t'});
  expect(db.prepare('SELECT message_content FROM template_versions').get()).toEqual({message_content:'公開版'});
  expect(db.prepare('SELECT consumer_id FROM template_references').get()).toEqual({consumer_id:'s'});
  expect(db.prepare('SELECT idempotency_key FROM template_publish_keys').get()).toEqual({idempotency_key:'key'});
  expect(db.prepare('SELECT step_id FROM scenario_actions').get()).toEqual({step_id:'step'});
  expect(db.prepare('SELECT action_id FROM scenario_action_fires').get()).toEqual({action_id:'action'});
  expect(db.prepare('SELECT broadcast_id FROM broadcast_send_claims').get()).toEqual({broadcast_id:'b'});
  for(const kind of ['imagemap','rich_message','coupon']) {
   db.prepare('UPDATE broadcasts SET message_type=?').run(kind);
   db.prepare('UPDATE templates SET message_type=?').run(kind);
   db.prepare('UPDATE scenario_steps SET message_type=?').run(kind);
  }
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'migration_595_%'").all()).toEqual([]);
  db.close();
 });
 it('表の作り直しの安全規則を満たす',()=>{
  expect(checkMigration(sql,'595_imagemap_message_kinds.sql')).toEqual({ok:true});
 });
});
