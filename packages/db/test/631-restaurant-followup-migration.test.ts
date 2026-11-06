import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { purgeTablesChildFirst, tenantScopeCondition } from '../src/data-retention-tables.js';
let db:Database.Database;
afterEach(()=>db?.close());
it('既存文を共通編集へ移し、過去の通知を再送せず、未承認で停止する',()=>{
 db=new Database(':memory:');db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'));
 // 後続631だけを外した実際の既存スキーマに、旧店舗と文面を置く。
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'rt_followup_%'").all() as {name:string}[])db.exec('DROP TRIGGER '+name);
 for(const table of ['scenario_source_jobs','rt_store_followup_step_bindings','rt_store_followup_templates'])db.exec('DROP TABLE '+table);
 db.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','a','店','s','t');
  INSERT INTO friends(id,line_account_id,line_user_id) VALUES('f','a','UID');
  INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
  INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店','S','a');
  INSERT INTO rt_line_flows(id,organization_id,store_id,flow_type,title,body) VALUES('old','o','s','reservation_24h','旧題','以前の案内です。');
  INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status) VALUES('old-reservation','s','line','人','UID',2,'2027-01-01T00:00:00Z','2027-01-01T01:00:00Z','confirmed');
  INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('notice','s','old-reservation',1,'UID','確定','key');`);
 db.exec(readFileSync(new URL('../migrations/631_restaurant_scenario_source_jobs.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT sending_status,approved_version_id FROM rt_store_followup_templates').get()).toEqual({sending_status:'stopped',approved_version_id:null});
 const step=db.prepare("SELECT message_content FROM scenario_steps WHERE id='restaurant-followup:s:reservation_24h'").get() as {message_content:string};
 expect(JSON.parse(step.message_content).body.contents[0].text).toBe('以前の案内です。');
 expect(step.message_content).toContain('{{var.restaurant_going}}');
 expect(db.prepare("SELECT COUNT(*) n FROM rt_reservation_event_receipts WHERE consumer_key='followup'").get()).toEqual({n:0});
 expect(db.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='notice'").get()).toEqual({valid:1});
 db.pragma('foreign_keys=ON');
 expect(()=>db.prepare("DELETE FROM scenario_steps WHERE id='restaurant-followup:s:post_visit'").run()).not.toThrow();
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('保存期限の削除は予約の返事・送り方・仕事を親より先に消す',()=>{
 const order=purgeTablesChildFirst();
 for(const [child,parent] of [['rt_reservation_confirmations','rt_reservations'],['rt_store_followup_step_bindings','rt_store_followup_templates'],['rt_store_followup_templates','rt_stores'],['scenario_source_jobs','scenario_versions'],['scenario_source_jobs','friends']])expect(order.indexOf(child)).toBeLessThan(order.indexOf(parent));
 expect(tenantScopeCondition('scenario_source_jobs')).toContain('line_account_id');
});
