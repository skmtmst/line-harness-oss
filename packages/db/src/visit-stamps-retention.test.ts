import {readFileSync} from 'node:fs';import {join} from 'node:path';import Database from 'better-sqlite3';import {it,expect} from 'vitest';
import {purgeTablesChildFirst,tenantScopeCondition} from './data-retention-tables.js';
it('顧客と店舗を削除してもスタンプ・統括配信の監査を残し、外部キーで削除を妨げない',()=>{
 const db=new Database(':memory:');try{
 db.exec(readFileSync(join(import.meta.dirname,'../bootstrap.sql'),'utf8'));db.exec('PRAGMA foreign_keys=ON');
 const tenant='00000000-0000-4000-8000-000000000001';
 db.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES('shop','試験','channel','unused','unused',?)").run(tenant);
 db.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-friend','shop')");
 db.prepare("INSERT INTO visit_stamp_cards(id,tenant_id,name,settings_json) VALUES('card',?,'試験','{}')").run(tenant);
 db.exec(`INSERT INTO visit_stamp_card_accounts VALUES('card','shop');INSERT INTO visit_stamp_wallets(card_id,friend_id) VALUES('card','friend');
 INSERT INTO visit_stamp_entries(id,card_id,friend_id,line_account_id,kind,delta,reason,idempotency_key,occurred_at) VALUES('entry','card','friend','shop','manual',3,'移行','request',datetime('now'));
 INSERT INTO visit_stamp_redemptions(id,card_id,friend_id,line_account_id,reward_id,reward_name,stamps,request_id) VALUES('reward','card','friend','shop','coffee','コーヒー',1,'request');
 INSERT INTO visit_stamp_paper_requests(id,card_id,friend_id,line_account_id,photo_url,stamps) VALUES('paper','card','friend','shop','https://example.com/photo',3);
 INSERT INTO visit_stamp_checkouts(kind,visit_id,line_account_id,amount,recorded_by) VALUES('restaurant','visit','shop',1000,'actor');`);
 db.prepare("INSERT INTO hq_broadcast_runs(id,tenant_id,request_id,actor_id,input_json) VALUES('run',?,'request','actor','{}')").run(tenant);
 db.exec(`INSERT INTO broadcasts(id,title,message_type,message_content,line_account_id,hq_run_id) VALUES('child','配信','text','本文','shop','run');
 INSERT INTO hq_broadcast_targets(run_id,line_account_id,account_name,broadcast_id) VALUES('run','shop','試験','child');
 INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) VALUES('audit','run','shop','actor','scheduled');`);
 for(const table of purgeTablesChildFirst())db.prepare(`DELETE FROM ${table} WHERE ${tenantScopeCondition(table)}`).run(tenant);
 expect(db.prepare('SELECT COUNT(*) n FROM friends').get()).toEqual({n:0});expect(db.prepare('SELECT COUNT(*) n FROM line_accounts').get()).toEqual({n:0});
 for(const table of ['visit_stamp_wallets','visit_stamp_paper_requests','visit_stamp_card_accounts'])expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0});
 for(const table of ['visit_stamp_entries','visit_stamp_redemptions','visit_stamp_checkouts','hq_broadcast_runs','hq_broadcast_targets','hq_broadcast_audit'])expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:1});
 expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
