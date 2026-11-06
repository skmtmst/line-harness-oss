import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('637/638を既存データへ適用しても列・CHECK・作業世代を保ち、過去の在庫起点を作らない',()=>{
 const db=new Database(':memory:');
 try {
  db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
  // Reconstruct the exact pre-637/638 schema from the generated full bootstrap.
  for(const r of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'friend_delivery_consents_%' OR name LIKE 'uid_migration_delivery_consents_%' OR name LIKE 'rt_inventory_source_%' OR name LIKE 'rt_direct_close_source%')").all() as {name:string}[])db.exec('DROP TRIGGER '+r.name);
  for(const table of ['uid_migration_delivery_consents','friend_delivery_consents','friend_delivery_consent_events','rt_inventory_rule_source_events'])db.exec('DROP TABLE '+table);
  for(const column of ['trigger_reservation_id','trigger_source','trigger_sources_json'])db.exec('ALTER TABLE rt_channel_close_tasks DROP COLUMN '+column);
  db.exec('ALTER TABLE rt_reservation_close_tasks DROP COLUMN trigger_source');
  db.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','店','a','s','t');
    INSERT INTO friends(id,line_account_id,line_user_id) VALUES('f','a','UID');
    INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','店');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店','S','a');
    INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity) VALUES('slot','s','2099-01-01T00:00:00Z',4);
    INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status) VALUES('r','s','phone','試験',1,'2099-01-01T00:00:00Z','2099-01-01T01:00:00Z','confirmed');
    INSERT INTO rt_channel_close_tasks(id,store_id,slot_id,channel,status,reason,remaining_seats,recipient_ids_json,generation) VALUES('legacy','s','slot','tabelog','done','limited',1,'["person"]',7);
    INSERT INTO rt_reservation_close_tasks(id,store_id,reservation_id,channel,starts_at,status,generation) VALUES('direct','s','r','tabelog','2099-01-01T00:00:00Z','reopen',3);`);
  const before=db.prepare('SELECT * FROM rt_channel_close_tasks').get() as Record<string,unknown>;
  for(const name of ['637_friend_delivery_consents.sql','638_restaurant_close_task_sources.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  expect(db.prepare('SELECT * FROM rt_channel_close_tasks').get()).toMatchObject({...before,trigger_reservation_id:null,trigger_source:null,trigger_sources_json:'[]'});
  expect(db.prepare('SELECT trigger_source,status,generation FROM rt_reservation_close_tasks').get()).toEqual({trigger_source:null,status:'reopen',generation:3});
  expect(db.prepare('SELECT COUNT(*) n FROM rt_inventory_rule_source_events').get()).toEqual({n:0});
  expect(db.prepare('SELECT COUNT(*) n FROM friend_delivery_consents').get()).toEqual({n:0});
  expect(()=>db.exec("UPDATE rt_channel_close_tasks SET status='opened'")).toThrow(/CHECK/);
  expect(()=>db.exec("UPDATE rt_channel_close_tasks SET reason='changed'")).toThrow(/CHECK/);
  db.pragma('foreign_keys=ON');
  db.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人希望','manual')");
  expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close();}
});
