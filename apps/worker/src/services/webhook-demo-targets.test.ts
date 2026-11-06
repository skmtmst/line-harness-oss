import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { webhookDemoTargets } from './webhook-demo-targets.js';
let sql:ReturnType<typeof createTestD1>;
beforeEach(()=>{
 sql=createTestD1();sql.raw.exec("INSERT INTO tenants(id,name,status) VALUES('ta','A','active'),('tb','B','active'),('ts','S','suspended');");
 for(const [id,tenant,active,archived] of [['source','ta',1,null],['good','ta',1,null],['stopped','ta',0,null],['archived','ta',1,'2026-01-01'],['other','tb',1,null],['suspended','ts',1,null]] as const){
  sql.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,is_active,archived_at) VALUES(?,?,?,?,?,?,?,?)').run(id,id,id,'fake','secret',tenant,active,archived);
  sql.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id,user_id,is_following) VALUES(?,?,?,?,1)').run(id,'U-'+id,id,'linked-user');
 }
});afterEach(()=>sql.raw.close());
test('SEC-05 active same-tenant destination alone is eligible for demo push',async()=>{
 expect((await webhookDemoTargets(sql.db,'linked-user','source')).map(r=>r.line_account_id)).toEqual(['good']);
});
test('stopped or unknown source cannot cross-send',async()=>{
 sql.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='source'");
 expect(await webhookDemoTargets(sql.db,'linked-user','source')).toEqual([]);
 expect(await webhookDemoTargets(sql.db,'linked-user','missing')).toEqual([]);
});
