import type { RestaurantFollowupTrigger } from '@line-crm/shared';
import { saveFollowupDraftFixture } from '../test-utils/restaurant-followup-draft.js';
import { beforeEach,afterEach,expect,it } from 'vitest';
import { getReminderDraftVersion,recordReminderDraftTest } from '@line-crm/db';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readRestaurantFollowupRows } from './restaurant-followup-rows.js';
import { readFollowupEngineGate,readFollowupEngineSnapshot } from './restaurant-followup-engine-approval.js';
import { readFollowupEngineDraftSnapshot,startRestaurantFollowupEngine,followupTestResource } from './restaurant-followup-engine-start.js';
let t:SqliteD1;
beforeEach(()=>{t=createTestD1({foreignKeys:true});t.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店舗','S','a');`);});
afterEach(()=>t.raw.close());
async function draft(engine:'reminder'|'automation'){
 const trigger:RestaurantFollowupTrigger=engine==='reminder'?'reservation_24h':'reservation_created';
 const row=(await readRestaurantFollowupRows(t.db,'store')).find(item=>item.trigger===trigger)!;
 await saveFollowupDraftFixture(t.db,'store',trigger,{expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:true,
  timing:engine==='reminder'?{mode:'time',offsetDays:-1,sendAtTime:'18:00'}:{mode:'countdown',offsetMinutes:0},messageBubbles:[{id:'body',type:'text',content:{text:'{{name}}さん、お待ちしています'}}]},'owner');
 return {trigger,...await readFollowupEngineDraftSnapshot(t.db,'store',trigger,1)};
}
for(const engine of ['reminder','automation'] as const)it(`${engine}の公開と承認はテストした内容の同じ版へ原子的に結び付く`,async()=>{
 const data=await draft(engine),{snapshot,targetId,trigger}=data;
 expect(await t.db.prepare(`SELECT 1 WHERE ${snapshot.publicationGuard!.sql}`).bind(...snapshot.publicationGuard!.binds).first()).not.toBeNull();
 expect(await t.db.prepare(`SELECT 1 WHERE ${snapshot.guard.sql}`).bind(...snapshot.guard.binds).first()).toBeNull();
 // 外部送信が成功した台帳だけを用意し、公開の実処理を検証する。
 t.raw.prepare(`INSERT INTO outbound_send_requests(idempotency_key,channel,resource_id,payload_hash,line_account_id,status,response_id,completed_at,created_at,updated_at)
 VALUES('proof','line',?,'body','a','succeeded','request','2026-10-31','2026-10-31','2026-10-31')`).run(followupTestResource(targetId,snapshot));
 if(engine==='reminder')await recordReminderDraftTest(t.db,(await getReminderDraftVersion(t.db,targetId))!.id,{succeeded:true,staffId:null});
 const result=await startRestaurantFollowupEngine(t.db,{storeId:'store',trigger,expectedTargetVersion:1,expectedContentHash:snapshot.contentHash,staffId:'owner',canApprove:true});
 expect(result.versionId).toBe(snapshot.versionId);
 const published=(await readFollowupEngineSnapshot(t.db,{engine,targetId,lineAccountId:'a',storeId:'store'}))!;
 expect(published.contentHash).toBe(snapshot.contentHash);
 expect(await readFollowupEngineGate(t.db,{engine,targetId,lineAccountId:'a',versionId:snapshot.versionId})).toMatchObject({managed:true,allowed:true});
});
it('未テストと承認権限なしは、公開も承認も作らない',async()=>{
 const {trigger,snapshot,targetId}=await draft('automation');
 const input={storeId:'store',trigger,expectedTargetVersion:1,expectedContentHash:snapshot.contentHash,staffId:'staff',canApprove:false};
 await expect(startRestaurantFollowupEngine(t.db,input)).rejects.toThrow('forbidden');
 await expect(startRestaurantFollowupEngine(t.db,{...input,canApprove:true})).rejects.toThrow('test_required');
 expect(t.raw.prepare('SELECT current_published_version_id FROM automation_definitions WHERE id=?').get(targetId)).toEqual({current_published_version_id:null});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_approval_requests').get()).toEqual({n:0});
});
