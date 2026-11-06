import { afterEach,beforeEach,expect,it } from 'vitest';
import { createReminderWithDraftVersion,publishReminderDraftVersion,recordReminderDraftTest } from '@line-crm/db';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processFriendFieldReminders } from '../features/friends/friend-field-reminders/index.js';
import { readFollowupEngineSnapshot } from './restaurant-followup-engine-approval.js';
import { readRestaurantReminderDeliveryGate } from './restaurant-reminder-delivery-gate.js';
let t:SqliteD1;
const now=new Date('2026-11-01T00:00:00+09:00');
beforeEach(()=>{t=createTestD1();t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店舗','t','s');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id,timezone) VALUES('store','org','食堂','S','a','Asia/Tokyo');
 INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','fixed-anniversary','2000-11-02');`);});
afterEach(()=>t.raw.close());
async function configured(){
 const draft=await createReminderWithDraftVersion(t.db,{name:'記念日前',lineAccountId:'a',triggerType:'friend_field',triggerFieldId:'fixed-anniversary',repeatYearly:true,leapYearPolicy:'feb28',deliveryMode:'time',
 stopConditions:{bookingCancelled:true,supportMarkCompleted:false,daysAfterTarget:null,friendBlocked:true},
 steps:[{stableStepId:'step',offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'記念日のご案内',templateId:null}]});
 await recordReminderDraftTest(t.db,draft.version.id,{succeeded:true,staffId:null});const v=await publishReminderDraftVersion(t.db,draft.reminder.id,null);
 const snapshot=await readFollowupEngineSnapshot(t.db,{engine:'reminder',targetId:draft.reminder.id,lineAccountId:'a',storeId:'store'});
 t.raw.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json) VALUES('approval','org','store','line_message','開始','approved',?)`)
 .run(JSON.stringify({operation:'start_restaurant_followup_engines',lineAccountId:'a',targets:[{trigger:'anniversary_before',engine:'reminder',targetId:draft.reminder.id,versionId:v.id,contentHash:snapshot!.contentHash}]}));
 t.raw.prepare(`INSERT INTO rt_store_followup_targets(store_id,trigger,engine,reminder_id,enabled,sending_status,approved_version_id,approved_content_hash,approval_id)
 VALUES('store','anniversary_before','reminder',?,1,'active',?,?,'approval')`).run(draft.reminder.id,v.id,snapshot!.contentHash);
}
it('未承認の記念日は登録せず、承認がそろえば同じ指紋付きで一度だけ登録する',async()=>{
 await configured();t.raw.exec("UPDATE rt_approval_requests SET status='pending'");
 expect((await processFriendFieldReminders(t.db,now)).enrolled).toBe(0);
 expect(t.raw.prepare('SELECT count(*) n FROM friend_reminders').get()).toEqual({n:0});
 t.raw.exec("UPDATE rt_approval_requests SET status='approved'");expect((await processFriendFieldReminders(t.db,now)).enrolled).toBe(1);
 expect((await processFriendFieldReminders(t.db,now)).enrolled).toBe(0);
 const row=t.raw.prepare('SELECT id,template_version_snapshot FROM friend_reminders').get() as {id:string;template_version_snapshot:string};
 expect(JSON.parse(row.template_version_snapshot).__source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect((await readRestaurantReminderDeliveryGate(t.db,row.id)).allowed).toBe(true);
});
it('記念日が変わったら古い基準日で送らず、送信直前の照合でも変更を検出する',async()=>{
 await configured();await processFriendFieldReminders(t.db,now);
 const row=t.raw.prepare('SELECT id FROM friend_reminders').get() as {id:string};
 const gate=await readRestaurantReminderDeliveryGate(t.db,row.id);expect(gate.allowed).toBe(true);
 t.raw.exec("UPDATE friend_field_values SET value='2000-11-03' WHERE friend_id='f'");
 expect((await readRestaurantReminderDeliveryGate(t.db,row.id)).allowed).toBe(false);
 if(gate.allowed)expect(await t.db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first()).toBeNull();
});
