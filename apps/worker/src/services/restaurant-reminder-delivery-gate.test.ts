import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createReminderWithDraftVersion,publishReminderDraftVersion,recordReminderDraftTest } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readFollowupEngineSnapshot } from './restaurant-followup-engine-approval.js';
import { readRestaurantReminderDeliveryGate } from './restaurant-reminder-delivery-gate.js';
import { syncRestaurantReminderTargets } from './restaurant-reminder-targets.js';
import { processReminderDeliveries } from './reminder-delivery.js';
import type { RestaurantEvent } from './restaurant-event-types.js';
let t:SqliteD1;
const now=new Date('2026-11-01T09:00:00Z');
beforeEach(()=>{
 t=createTestD1();t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店舗','t','s');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id,timezone) VALUES('store','org','食堂','S','a','Asia/Tokyo');
 INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
 VALUES('r1','store','line','友だち','UID',2,'2026-11-01T10:00:00Z','2026-11-01T11:00:00Z','confirmed'),
 ('r2','store','line','友だち','UID',4,'2026-11-02T10:00:00Z','2026-11-02T11:00:00Z','confirmed');`);
});
afterEach(()=>t.raw.close());
async function configured(){
 const draft=await createReminderWithDraftVersion(t.db,{name:'前日',lineAccountId:'a',triggerType:'manual',deliveryMode:'time',
 stopConditions:{bookingCancelled:true,supportMarkCompleted:false,daysAfterTarget:null,friendBlocked:true},
 steps:[{stableStepId:'step',offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'{{reservation_datetime}} {{var.guest_count}}名 {{var.store_name}} {{meet_url}}',templateId:null}]});
 await recordReminderDraftTest(t.db,draft.version.id,{succeeded:true,staffId:null});
 const version=await publishReminderDraftVersion(t.db,draft.reminder.id,null);
 const snapshot=await readFollowupEngineSnapshot(t.db,{engine:'reminder',targetId:draft.reminder.id,lineAccountId:'a',storeId:'store'});
 t.raw.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json) VALUES('approval','org','store','line_message','開始','approved',?)`)
 .run(JSON.stringify({operation:'start_restaurant_followup_engines',lineAccountId:'a',targets:[{trigger:'reservation_24h',engine:'reminder',targetId:draft.reminder.id,versionId:version.id,contentHash:snapshot!.contentHash}]}));
 t.raw.prepare(`INSERT INTO rt_store_followup_targets(store_id,trigger,engine,reminder_id,enabled,sending_status,approved_version_id,approved_content_hash,approval_id)
 VALUES('store','reservation_24h','reminder',?,1,'active',?,?,'approval')`).run(draft.reminder.id,version.id,snapshot!.contentHash);
 const event=t.raw.prepare("SELECT * FROM rt_reservation_events WHERE reservation_id='r2' ORDER BY reservation_version DESC LIMIT 1").get() as RestaurantEvent;
 await syncRestaurantReminderTargets(t.db,event);
 const row=t.raw.prepare('SELECT id FROM friend_reminders').get() as {id:string};expect(row).toBeTruthy();
 return {id:row.id,reminderId:draft.reminder.id};
}
function client(){const push=vi.fn(async()=>({data:{},requestId:'ok'}));return {push,client:{pushMessageWithRequestId:push} as unknown as LineClient};}
it('同じ人の近い別予約や面談を使わず、その予約の日時と人数を送る',async()=>{
 await configured();const c=client();const result=await processReminderDeliveries(t.db,c.client,{now,pause:async()=>{},resolveClient:async()=>c.client});
 expect(result.succeeded).toBe(1);expect(c.push).toHaveBeenCalledTimes(1);
 const log=t.raw.prepare("SELECT content FROM messages_log WHERE source='reminder'").get() as {content:string};
 expect(log.content).toContain('2026-11-02');expect(log.content).toContain('19:00');expect(log.content).toContain('4名 食堂');
});
it.each(['pending','stopped','owner','fingerprint','target','cancelled','person','timezone'] as const)('変わった承認・送り手・予約では送信も新しい実行行も作らない: %s',async(kind)=>{
 const row=await configured();
 if(kind==='pending')t.raw.exec("UPDATE rt_approval_requests SET status='pending'");
 if(kind==='stopped')t.raw.exec("UPDATE rt_store_followup_targets SET sending_status='stopped'");
 if(kind==='owner')t.raw.exec("UPDATE rt_store_followup_targets SET engine='scenario'");
 if(kind==='fingerprint')t.raw.exec("UPDATE friend_reminders SET template_version_snapshot='{}'");
 if(kind==='target')t.raw.exec("UPDATE friend_reminders SET target_date='2026-11-03T10:00:00Z'");
 if(kind==='cancelled')t.raw.exec("UPDATE rt_reservations SET status='cancelled',customer_version=customer_version+1 WHERE id='r2'");
 if(kind==='person')t.raw.exec("UPDATE rt_reservations SET line_uid='OTHER',customer_version=customer_version+1 WHERE id='r2'");
 if(kind==='timezone')t.raw.exec("UPDATE rt_stores SET timezone='America/New_York'");
 expect((await readRestaurantReminderDeliveryGate(t.db,row.id)).allowed).toBe(false);
 const c=client();await processReminderDeliveries(t.db,c.client,{now,pause:async()=>{},resolveClient:async()=>c.client});
 expect(c.push).not.toHaveBeenCalled();expect(t.raw.prepare('SELECT count(*) n FROM reminder_delivery_runs').get()).toEqual({n:0});
});
it.each(['approval','reservation','reschedule'] as const)('本文解決後の割込みでも外部送信を止める: %s',async(kind)=>{
 await configured();const c=client();await processReminderDeliveries(t.db,c.client,{now,pause:async()=>{},resolveClient:async()=>c.client,beforePush:async()=>{
 if(kind==='approval')t.raw.exec("UPDATE rt_approval_requests SET status='pending'");
 if(kind==='reservation')t.raw.exec("UPDATE rt_reservations SET status='cancelled',customer_version=customer_version+1 WHERE id='r2'");
 if(kind==='reschedule')t.raw.exec("UPDATE rt_reservations SET starts_at='2026-11-03T10:00:00Z',ends_at='2026-11-03T11:00:00Z',customer_version=customer_version+1 WHERE id='r2'; UPDATE friend_reminders SET target_date='2026-11-03T10:00:00.000Z'");
 }});expect(c.push).not.toHaveBeenCalled();
});
it('読んだ後に予約が変われば、保持していたSQLの送信権が消える',async()=>{
 const row=await configured(),gate=await readRestaurantReminderDeliveryGate(t.db,row.id);expect(gate.allowed).toBe(true);
 t.raw.exec("UPDATE rt_reservations SET guest_count=5,customer_version=customer_version+1 WHERE id='r2'");
 if(gate.allowed)expect(await t.db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first()).toBeNull();
});

it('未来の未試行予定は変更に追従するが、一度試行した要求の古い差し込みは再送しない',async()=>{
 await configured();const c=client();
 await processReminderDeliveries(t.db,c.client,{now:new Date('2026-11-01T08:00:00Z'),pause:async()=>{},resolveClient:async()=>c.client});
 t.raw.exec("UPDATE rt_reservations SET guest_count=5,customer_version=customer_version+1 WHERE id='r2'");
 c.push.mockRejectedValueOnce(Object.assign(new Error('rejected'),{status:429}));
 await processReminderDeliveries(t.db,c.client,{now,pause:async()=>{},resolveClient:async()=>c.client});
 expect(c.push).toHaveBeenCalledTimes(1);
 t.raw.exec("UPDATE rt_reservations SET guest_count=6,customer_version=customer_version+1 WHERE id='r2'; UPDATE reminder_delivery_runs SET status='retry_wait',next_retry_at='2026-11-01T09:00:00Z'");
 await processReminderDeliveries(t.db,c.client,{now:new Date('2026-11-01T09:05:00Z'),pause:async()=>{},resolveClient:async()=>c.client});
 expect(c.push).toHaveBeenCalledTimes(1);
 expect(t.raw.prepare('SELECT status,last_error_code FROM reminder_delivery_runs').get()).toEqual({status:'permanent_failed',last_error_code:'restaurant_source_changed'});
});
