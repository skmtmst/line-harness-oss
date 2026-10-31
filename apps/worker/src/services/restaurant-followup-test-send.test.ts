import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { saveFollowupDraftFixture } from '../test-utils/restaurant-followup-draft.js';
import { readRestaurantFollowupRows } from './restaurant-followup-rows.js';
import { testRestaurantFollowupEngine } from './restaurant-followup-test-send.js';
import { startRestaurantFollowupEngine } from './restaurant-followup-engine-start.js';
import { readRestaurantFollowupEngineStates } from './restaurant-followup-engine-state.js';
import { stopOperationCapabilities,restoreOperationIncident } from '@line-crm/db';
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:vi.fn(async()=>true)}));
let t:SqliteD1;
beforeEach(()=>{t=createTestD1({foreignKeys:true});t.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','token','secret');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店舗','S','a');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','登録した宛先');
 INSERT INTO account_settings(line_account_id,key,value) VALUES('a','test_recipients','["f"]');`);});
afterEach(()=>t.raw.close());
async function draft(trigger:'reservation_created'|'reservation_24h'='reservation_created'){
 const row=(await readRestaurantFollowupRows(t.db,'store')).find(row=>row.trigger===trigger)!;
 await saveFollowupDraftFixture(t.db,'store',trigger,{expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:true,
  timing:trigger==='reservation_created'?{mode:'countdown',offsetMinutes:0}:{mode:'time',offsetDays:-1,sendAtTime:'18:00'},
  messageBubbles:[{id:'one',type:'text',content:{text:'{{name}}さん、{{var.guest_count}}名のご予約の見本'}}]},'owner');
 return {storeId:'store',trigger,expectedTargetVersion:1,staffId:'owner'};
}
for(const trigger of ['reservation_created','reservation_24h'] as const)it(`${trigger}は登録済み宛先への実テスト成功のあとだけ、同じ版で送り始める`,async()=>{
 const input=await draft(trigger),push=vi.fn(async()=>({data:null,requestId:'request'}));
 const result=await testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})});
 expect(result).toMatchObject({recipientKind:'registered',replayed:false});expect(push).toHaveBeenCalledTimes(1);
 expect(push.mock.calls[0]).toEqual(expect.arrayContaining(['UID']));
 expect(JSON.stringify(push.mock.calls)).toContain('登録した宛先さん、2名');
 expect(t.raw.prepare('SELECT count(*) n FROM rt_reservation_confirmations').get()).toEqual({n:0});
 expect((await readRestaurantFollowupEngineStates(t.db,'store'))[0].effectiveSendingStatus).toBe('stopped');
 expect((await readRestaurantFollowupEngineStates(t.db,'store'))[0].detailPath).toMatch(trigger==='reservation_24h'?/^\/reminders\/detail\?id=/:/^\/automations\/drafts\?id=/);
 const repeated=await testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})});
 expect(repeated.replayed).toBe(true);expect(push).toHaveBeenCalledTimes(1);
 await startRestaurantFollowupEngine(t.db,{...input,expectedContentHash:result.contentHash,canApprove:true});
 expect((await readRestaurantFollowupEngineStates(t.db,'store'))[0].effectiveSendingStatus).toBe('active');
 if(trigger==='reservation_created')t.raw.exec("UPDATE automation_definitions SET status='stopped'");else t.raw.exec('UPDATE reminders SET is_active=0');
 expect((await readRestaurantFollowupEngineStates(t.db,'store'))[0]).toMatchObject({effectiveSendingStatus:'stopped',reason:expect.stringContaining('止まっています')});
});
it('登録が無い宛先や、送る直前に登録から外れた宛先には送らない',async()=>{
 const input=await draft(),push=vi.fn(async()=>({data:null,requestId:'request'}));
 t.raw.exec("UPDATE account_settings SET value='[]' WHERE key='test_recipients'");
 await expect(testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})})).rejects.toThrow('RECIPIENT_NOT_AVAILABLE');
 t.raw.exec("UPDATE account_settings SET value='[\"f\"]' WHERE key='test_recipients'");
 await expect(testRestaurantFollowupEngine(t.db,input,{createClient:()=>{t.raw.exec("UPDATE account_settings SET value='[]' WHERE key='test_recipients'");return {pushMessageWithRequestId:push};}})).rejects.toMatchObject({deliveryStatus:'failed',blockedReason:'REMINDER_TEST_RECIPIENT_NOT_AVAILABLE'});
 expect(push).not.toHaveBeenCalled();
 expect(t.raw.prepare("SELECT count(*) n FROM outbound_send_requests WHERE status='succeeded'").get()).toEqual({n:0});
});
it('受理が不明なテストを自動で送り直さず、成功したことにしない',async()=>{
 const input=await draft(),push=vi.fn(async()=>{throw new Error('network response lost');});
 const send=()=>testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})});
 await expect(send()).rejects.toThrow();await expect(send()).rejects.toThrow();expect(push).toHaveBeenCalledTimes(1);
 expect(t.raw.prepare("SELECT count(*) n FROM outbound_send_requests WHERE status='succeeded'").get()).toEqual({n:0});
});
it('複数の要求の途中で受理不明になっても、先の要求を送り直さず全体の成功を作らない',async()=>{
 const row=(await readRestaurantFollowupRows(t.db,'store')).find(row=>row.trigger==='reservation_created')!;
 await saveFollowupDraftFixture(t.db,'store','reservation_created',{expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:true,
  timing:{mode:'countdown',offsetMinutes:0},messageBubbles:Array.from({length:5},(_,i)=>({id:`part-${i}`,type:'text',content:{text:`吹き出し${i+1}`}}))},'owner');
 const input={storeId:'store',trigger:'reservation_created' as const,expectedTargetVersion:1,staffId:'owner'};
 let attempts=0;const push=vi.fn(async()=>{if(++attempts===2)throw new Error('network response lost');return {data:null,requestId:'first'};});
 const send=()=>testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})});
 await expect(send()).rejects.toThrow();await expect(send()).rejects.toThrow();expect(push).toHaveBeenCalledTimes(2);
 expect(t.raw.prepare('SELECT status FROM outbound_send_requests ORDER BY rowid').all()).toEqual([{status:'succeeded'},{status:'unknown'}]);
 expect(t.raw.prepare('SELECT count(*) n FROM rt_approval_requests').get()).toEqual({n:0});
});
it('テストの送達中に編集されても、別の内容をテスト成功にしない',async()=>{
 const input=await draft(),push=vi.fn(async()=>{t.raw.exec("UPDATE automation_versions SET action_config='[]' WHERE status='draft'");return {data:null,requestId:'request'};});
 await expect(testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})})).rejects.toThrow();
 expect(t.raw.prepare("SELECT count(*) n FROM outbound_send_requests WHERE resource_id NOT LIKE '%:f:%' AND status='succeeded'").get()).toEqual({n:0});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_approval_requests').get()).toEqual({n:0});
});
for(const trigger of ['reservation_created','reservation_24h'] as const)it(`${trigger}の緊急停止中は送らず、停止前の照合だけなら復旧後に試せる`,async()=>{
 const input=await draft(trigger),push=vi.fn(async()=>({data:null,requestId:'request'}));
 const stopped=await stopOperationCapabilities(t.db,{lineAccountId:'a',capabilities:[trigger==='reservation_24h'?'reminder_dispatch':'automation_actions'],expectedVersion:0,actorId:'owner',reason:'障害対応'});
 if(stopped.status!=='changed')throw new Error('stop failed');
 const send=()=>testRestaurantFollowupEngine(t.db,input,{createClient:()=>({pushMessageWithRequestId:push})});
 await expect(send()).rejects.toMatchObject({deliveryStatus:'failed',blockedReason:'sending_stopped'});expect(push).not.toHaveBeenCalled();
 expect(t.raw.prepare('SELECT status,failure_code FROM outbound_send_requests').get()).toEqual({status:'failed',failure_code:'NOTIFICATION_PRECONDITION_CHANGED'});
 await restoreOperationIncident(t.db,{incidentId:stopped.incident.id,expectedVersion:stopped.control.version,actorId:'owner'});
 await expect(send()).resolves.toMatchObject({replayed:false});expect(push).toHaveBeenCalledTimes(1);
});
