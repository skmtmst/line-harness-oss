import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { listAdEventMappings,saveAdEventMapping,queueMappedAdConversion,recoverMappedAdConversions } from '../src/ad-event-mappings.js';
import { trackConversion } from '../src/conversions.js';
function setup(){
 const raw=new Database(':memory:');raw.exec(readFileSync('bootstrap.sql','utf8'));const db=asD1(raw);const now=new Date().toISOString();
 raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','token','secret'),('b','b','B','token','secret');
 INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
 INSERT INTO conversion_points(id,name,event_type,line_account_id,status,value_mode,value,count_repeat,deduplication_mode) VALUES('p','Purchase','purchase','a','active','fixed',3200,1,'every'),('other','Other','purchase','b','active','none',NULL,1,'every');`);
 for(const provider of ['meta','google'])raw.prepare(`INSERT INTO ad_platforms(id,name,line_account_id,config,is_active,verified_at) VALUES(?,?,?, ?,1,?)`).run(provider,provider,'a',JSON.stringify({click_id_validity_days:30,conversion_action_id:'111',currency:'JPY'}),now);
 raw.prepare(`INSERT INTO ref_tracking(id,ref_code,friend_id,line_account_id,fbclid,gclid,created_at,ad_conversion_consent_at) VALUES('r','ad','f','a','fb','gc',?,?)`).run(now,now);
 return{raw,db};
}
it('lists automatic names and protects scope and stale versions',async()=>{
 const{db}=setup();expect(await listAdEventMappings(db,'a')).toEqual(expect.arrayContaining([expect.objectContaining({pointId:'p',provider:'meta',eventName:'Purchase',version:0})]));
 expect((await listAdEventMappings(db,'a')).some(m=>m.pointId==='other')).toBe(false);
 expect(await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'manual',eventName:'CustomPurchase',expectedVersion:0})).toBe(true);
 expect(await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'off',expectedVersion:0})).toBe(false);
 expect(await saveAdEventMapping(db,'p',{account_id:'a',provider:'google',mode:'off',expectedVersion:3})).toBe(false);
 expect(await saveAdEventMapping(db,'other',{account_id:'a',provider:'meta',mode:'off',expectedVersion:0})).toBe(false);
});
it('queues actual tracked conversions once with frozen names, click and Google target',async()=>{
 const{db,raw}=setup();await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'manual',eventName:'CustomPurchase',expectedVersion:0});
 await saveAdEventMapping(db,'p',{account_id:'a',provider:'google',mode:'manual',eventName:'purchase_first',googleActionId:'222',expectedVersion:0});
 const event=await trackConversion(db,{conversionPointId:'p',friendId:'f',idempotencyKey:'order-1'});
 expect(raw.prepare('SELECT event_name,event_value,selection_reason FROM ad_conversion_outbox ORDER BY event_name').all()).toEqual([{event_name:'CustomPurchase',event_value:3200,selection_reason:'eligible'},{event_name:'purchase_first',event_value:3200,selection_reason:'eligible'}]);
 await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'off',expectedVersion:1});
 await queueMappedAdConversion(db,event.id);expect(raw.prepare('SELECT COUNT(*) n FROM ad_conversion_outbox').get()).toEqual({n:2});
 expect(raw.prepare(`SELECT snapshot_json FROM ad_event_mapping_dispatches WHERE ad_platform_id='google'`).get()).toMatchObject({snapshot_json:expect.stringContaining('"googleActionId":"222"')});
 await trackConversion(db,{conversionPointId:'p',friendId:'f',idempotencyKey:'order-1'});expect(raw.prepare('SELECT COUNT(*) n FROM ad_conversion_outbox').get()).toEqual({n:2});
});
it('recovers interruption, honors off, and never sends to a newly connected account',async()=>{
 const{db,raw}=setup();await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'off',expectedVersion:0});await saveAdEventMapping(db,'p',{account_id:'a',provider:'google',mode:'off',expectedVersion:0});
 raw.exec(`INSERT INTO conversion_events(id,conversion_point_id,friend_id,event_type_snapshot,value_snapshot) VALUES('interrupted','p','f','purchase',100);`);
 await recoverMappedAdConversions(db);expect(raw.prepare('SELECT COUNT(*) n FROM ad_conversion_outbox').get()).toEqual({n:0});expect(raw.prepare('SELECT COUNT(*) n FROM ad_event_mapping_dispatches WHERE completed=1').get()).toEqual({n:2});
 raw.exec(`UPDATE ad_platforms SET is_active=0; INSERT INTO conversion_events(id,conversion_point_id,friend_id,event_type_snapshot) VALUES('inactive','p','f','purchase'); UPDATE ad_platforms SET is_active=1;`);
 await saveAdEventMapping(db,'p',{account_id:'a',provider:'meta',mode:'auto',expectedVersion:1});
 await recoverMappedAdConversions(db);expect(raw.prepare('SELECT COUNT(*) n FROM ad_conversion_outbox').get()).toEqual({n:0});
 raw.exec(`INSERT INTO conversion_events(id,conversion_point_id,friend_id,event_type_snapshot) VALUES('recover','p','f','purchase'); UPDATE friends SET line_account_id='b' WHERE id='f';`);
 await recoverMappedAdConversions(db);expect(raw.prepare('SELECT line_account_id,event_name FROM ad_conversion_outbox').all()).toEqual([{line_account_id:'a',event_name:'Purchase'}]);
});
