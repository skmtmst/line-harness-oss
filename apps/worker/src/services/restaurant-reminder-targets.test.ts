import { afterEach, beforeEach, expect, it } from 'vitest';
import { createReminderWithDraftVersion, publishReminderDraftVersion, recordReminderDraftTest, type ReminderDraftSettings } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { syncRestaurantReminderTargets } from './restaurant-reminder-targets.js';
import type { RestaurantEvent } from './restaurant-event-types.js';

let t: SqliteD1;
beforeEach(() => {
  t=createTestD1({foreignKeys:true});
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s'),('b','d','他店','t','s');
    INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち'),('g','b','OTHER','他店の人');
    INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店舗','S','a');`);
});
afterEach(()=>t.raw.close());

async function target(trigger='reservation_24h', account='a') {
  const settings: ReminderDraftSettings={name:'前日',lineAccountId:account,triggerType:'manual',deliveryMode:'time',
    stopConditions:{bookingCancelled:true,supportMarkCompleted:false,daysAfterTarget:null,friendBlocked:true},
    steps:[{stableStepId:crypto.randomUUID(),offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'予約のお知らせ',templateId:null,targetCondition:{},action:{}}]};
  const {reminder,version}=await createReminderWithDraftVersion(t.db,settings);
  await recordReminderDraftTest(t.db,version.id,{succeeded:true,staffId:null});
  const published=await publishReminderDraftVersion(t.db,reminder.id,null);
  const approval=crypto.randomUUID();
  const payload={operation:'start_restaurant_followup_engines',lineAccountId:'a',targets:[{trigger,engine:'reminder',targetId:reminder.id,versionId:published.id,contentHash:'fixture'}]};
  t.raw.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json) VALUES(?,'o','s','menu_change','承認','approved',?)`).run(approval,JSON.stringify(payload));
  t.raw.prepare(`INSERT INTO rt_store_followup_targets(store_id,trigger,engine,reminder_id,enabled,sending_status,approved_version_id,approved_content_hash,approval_id)
    VALUES('s',?,'reminder',?,1,'active',?,'fixture',?)`).run(trigger,reminder.id,published.id,approval);
  return {reminderId:reminder.id,versionId:published.id,approval};
}
function reservation(id='r',at='2026-11-02T10:00:00Z') {
  t.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
    VALUES(?,'s','line','友だち','UID',2,?,?,'confirmed')`).run(id,at,new Date(Date.parse(at)+3600000).toISOString());
  return event(id);
}
function event(id='r') {
  return t.raw.prepare('SELECT * FROM rt_reservation_events WHERE reservation_id=? ORDER BY reservation_version DESC LIMIT 1').get(id) as RestaurantEvent;
}
const enrollments=()=>t.raw.prepare('SELECT reminder_id,friend_id,target_date,source_id,status FROM friend_reminders ORDER BY source_id,reminder_id').all();

it('未承認は0、承認した実物の公開版に予約ID付きで登録し、再配送しても増やさない',async()=>{
  const configured=await target(),e=reservation();
  t.raw.prepare("UPDATE rt_approval_requests SET status='pending' WHERE id=?").run(configured.approval);
  await syncRestaurantReminderTargets(t.db,e);expect(enrollments()).toEqual([]);
  t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(configured.approval);
  await syncRestaurantReminderTargets(t.db,e);await syncRestaurantReminderTargets(t.db,e);
  expect(enrollments()).toEqual([{reminder_id:configured.reminderId,friend_id:'f',target_date:'2026-11-02T10:00:00.000Z',source_id:'r',status:'active'}]);
  expect(t.raw.prepare('SELECT reminder_version_id,timezone FROM friend_reminders').get()).toEqual({reminder_version_id:configured.versionId,timezone:'Asia/Tokyo'});
});
it('同じ人の別予約と別の送り方を区別し、変更した予約の未送信予定だけを動かす',async()=>{
  await target();await target('reservation_2h');
  await syncRestaurantReminderTargets(t.db,reservation('r1'));await syncRestaurantReminderTargets(t.db,reservation('r2'));
  expect(enrollments()).toHaveLength(4);
  t.raw.exec("UPDATE rt_reservations SET starts_at='2026-11-03T11:00:00Z',ends_at='2026-11-03T12:00:00Z',customer_version=customer_version+1 WHERE id='r1'");
  await syncRestaurantReminderTargets(t.db,event('r1'));
  expect(enrollments().filter((r:any)=>r.source_id==='r1').every((r:any)=>r.target_date==='2026-11-03T11:00:00.000Z')).toBe(true);
  expect(enrollments().filter((r:any)=>r.source_id==='r2').every((r:any)=>r.target_date==='2026-11-02T10:00:00.000Z')).toBe(true);
});
it('取消はその予約の登録だけを止め、旧イベントで復活・巻戻しをしない',async()=>{
  await target();const old=reservation('r1');await syncRestaurantReminderTargets(t.db,old);await syncRestaurantReminderTargets(t.db,reservation('r2'));
  t.raw.exec("UPDATE rt_reservations SET status='cancelled',customer_version=customer_version+1 WHERE id='r1'");
  await syncRestaurantReminderTargets(t.db,event('r1'));await syncRestaurantReminderTargets(t.db,old);
  expect(enrollments().map((r:any)=>[r.source_id,r.status])).toEqual([['r1','cancelled'],['r2','active']]);
});
it.each(['stopped','old-version','foreign-account','foreign-friend','wrong-owner','wrong-approval','broken-approval'])('境界が違う時は登録しない: %s',async(kind)=>{
  const configured=await target('reservation_24h',kind==='foreign-account'?'b':'a'),e=reservation();
  if(kind==='stopped')t.raw.exec("UPDATE rt_store_followup_targets SET sending_status='stopped'");
  if(kind==='old-version')t.raw.exec("UPDATE reminders SET current_published_version_id=NULL");
  if(kind==='foreign-friend')e.friend_id='g';
  if(kind==='wrong-owner')t.raw.exec("UPDATE rt_store_followup_targets SET engine='scenario'");
  if(kind==='broken-approval')t.raw.prepare("UPDATE rt_approval_requests SET payload_json='not-json' WHERE id=?").run(configured.approval);
  if(kind==='wrong-approval')t.raw.prepare("UPDATE rt_approval_requests SET payload_json='{}' WHERE id=?").run(configured.approval);
  await syncRestaurantReminderTargets(t.db,e);expect(enrollments()).toEqual([]);
});
it('通常の手動登録と面談の登録は取消の対象にしない',async()=>{
  const {reminderId}=await target(),e=reservation();
  const {enrollFriendInReminder}=await import('@line-crm/db');
  await enrollFriendInReminder(t.db,{friendId:'f',reminderId,targetDate:'2026-11-02T10:00:00Z',sourceKind:'meet',sourceId:'r',sourceEventId:'meet-r'});
  await syncRestaurantReminderTargets(t.db,e);
  t.raw.exec("UPDATE rt_reservations SET status='cancelled',customer_version=customer_version+1 WHERE id='r'");await syncRestaurantReminderTargets(t.db,event());
  expect(t.raw.prepare('SELECT source_kind,status FROM friend_reminders ORDER BY source_kind').all()).toEqual([{source_kind:'meet',status:'active'},{source_kind:'restaurant_reservation',status:'cancelled'}]);
});
it('候補を読んだ後に予約の版が進んでも、古い変更を書き込まない',async()=>{
  await target();await syncRestaurantReminderTargets(t.db,reservation());
  t.raw.exec("UPDATE rt_reservations SET starts_at='2026-11-03T11:00:00Z',ends_at='2026-11-03T12:00:00Z',customer_version=customer_version+1 WHERE id='r'");
  const original=t.db.batch.bind(t.db);
  const db=new Proxy(t.db,{get(obj,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{
    t.raw.exec("UPDATE rt_reservations SET customer_version=customer_version+1 WHERE id='r'");return original(statements);
  };const value=Reflect.get(obj,key);return typeof value==='function'?value.bind(obj):value;}});
  await syncRestaurantReminderTargets(db,event());
  expect((enrollments()[0] as any).target_date).toBe('2026-11-02T10:00:00.000Z');
});

it('停止中も登録済みの基準日を合わせ、再承認後に古い日時を残さない',async()=>{
 await target();await syncRestaurantReminderTargets(t.db,reservation());
 t.raw.exec("UPDATE rt_store_followup_targets SET sending_status='stopped';UPDATE rt_reservations SET starts_at='2026-11-03T11:00:00Z',ends_at='2026-11-03T12:00:00Z',customer_version=customer_version+1 WHERE id='r'");
 await syncRestaurantReminderTargets(t.db,event());
 t.raw.exec("UPDATE rt_store_followup_targets SET sending_status='active'");
 expect((enrollments()[0] as any).target_date).toBe('2026-11-03T11:00:00.000Z');
});
