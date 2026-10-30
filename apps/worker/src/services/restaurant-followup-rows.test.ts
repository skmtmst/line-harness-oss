import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { publishScenarioVersion } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readRestaurantFollowupRows, setRestaurantFollowupRow } from './restaurant-followup-rows.js';
import { requestRestaurantFollowupApproval } from './restaurant-followup.js';
import { saveProfile } from './style-setup.js';
import { scheduleRestaurantAnniversaries, restaurantAnniversaryState } from './restaurant-anniversary-followup.js';
import { dispatchWaitlistInvites } from '../features/booking/booking-waitlist.js';
import type { Env } from '../worker-env.js';
import type { ScenarioSourceJob } from '../features/scenarios/scenario-source-jobs.js';
const legacySend=vi.hoisted(()=>vi.fn(async()=>true));
vi.mock('../features/booking/booking-automatic-line.js',()=>({sendAutomaticBookingLine:legacySend}));
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:vi.fn(async()=>true)}));
let t: SqliteD1;
beforeEach(()=>{
 legacySend.mockClear();
 t=createTestD1({foreignKeys:true});
 t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
 INSERT INTO staff_members(id,name,role,api_key) VALUES('owner','所有者','owner','fixture-key');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店舗','S','a');`);
});
afterEach(()=>{vi.restoreAllMocks();t.raw.close()});
const count=(table:string)=> (t.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
async function enable(trigger:Parameters<typeof setRestaurantFollowupRow>[2]='reservation_created') {
 const row=(await readRestaurantFollowupRows(t.db,'s')).find(r=>r.trigger===trigger)!;
 return (await setRestaurantFollowupRow(t.db,'s',trigger,row.version,true))!;
}
async function approve() {
 const template=t.raw.prepare('SELECT scenario_id,template_version FROM rt_store_followup_templates').get() as {scenario_id:string;template_version:number};
 await publishScenarioVersion(t.db,template.scenario_id,{staffId:'owner',idempotencyKey:crypto.randomUUID()});
 const version=(t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as {template_version:number}).template_version;
 const approval=(await requestRestaurantFollowupApproval(t.db,'s',version,'owner'))!;
 expect(approval).not.toBeNull();t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(approval.id);
}
describe('停止行とオン時の原子的な作成',()=>{
 it('新規店の本体は0、繰り返し・同時の読取でも初期文付き7行だけを作る',async()=>{
  expect(count('scenarios')).toBe(0);
  t.raw.exec('DELETE FROM rt_store_followup_rows');
  const pages=await Promise.all([readRestaurantFollowupRows(t.db,'s'),readRestaurantFollowupRows(t.db,'s')]);
  expect(pages[0]).toHaveLength(7);expect(count('rt_store_followup_rows')).toBe(7);
  expect(pages[0].every(row=>row.step_id===null&&row.initial_message.length>0)).toBe(true);
  expect(pages[0].find(row=>row.trigger==='reservation_24h')!.default_offset_minutes).toBe(-1440);
  expect(count('scenario_steps')).toBe(0);expect(count('rt_store_followup_step_bindings')).toBe(0);
 });
 it('飲食の選択で7行を用意し、他業種と後で選ぶ状態には配線しない',async()=>{
  t.raw.exec('DELETE FROM rt_store_followup_rows');
  await saveProfile(t.db,'a',null,'owner',{expectedVersion:0,style:'salon'});
  expect(count('rt_store_followup_rows')).toBe(0);
  await saveProfile(t.db,'a',null,'owner',{expectedVersion:1,style:'restaurant',styleMode:'later'});
  expect(count('rt_store_followup_rows')).toBe(0);
  await saveProfile(t.db,'a',null,'owner',{expectedVersion:2,style:'restaurant',styleMode:'configured'});
  expect(count('rt_store_followup_rows')).toBe(7);expect(count('rt_store_followup_templates')).toBe(0);
 });
 it('初回オンは共通本体1つと対象の一歩だけ。停止から再開しても増えない',async()=>{
  const first=await enable();expect(first.step_id).toBeTruthy();
  expect(count('scenarios')).toBe(1);expect(count('scenario_steps')).toBe(1);
  const off=(await setRestaurantFollowupRow(t.db,'s','reservation_created',first.version,false))!;
  const on=(await setRestaurantFollowupRow(t.db,'s','reservation_created',off.version,true))!;
  expect(on.step_id).toBe(first.step_id);expect(count('scenario_steps')).toBe(1);
  await enable('reservation_24h');expect(count('scenarios')).toBe(1);expect(count('scenario_steps')).toBe(2);
  const confirmation=t.raw.prepare("SELECT message_content FROM scenario_steps WHERE id=(SELECT step_id FROM rt_store_followup_rows WHERE trigger='reservation_24h')").get() as {message_content:string};
  expect(JSON.parse(confirmation.message_content).footer.contents.map((b:any)=>b.action.data)).toEqual(['{{var.restaurant_going}}','{{var.restaurant_change}}','{{var.restaurant_cancel}}']);
 });
 it('未作成の行のオフは本体を作らない',async()=>{
  await readRestaurantFollowupRows(t.db,'s');
  expect(await setRestaurantFollowupRow(t.db,'s','reservation_created',1,false)).toMatchObject({step_id:null});expect(count('scenarios')).toBe(0);
 });
 it('同時オンと古い版の再送は片方だけ成功し、本体を二重に作らない',async()=>{
  await readRestaurantFollowupRows(t.db,'s');
  const results=await Promise.all([setRestaurantFollowupRow(t.db,'s','reservation_created',1,true),setRestaurantFollowupRow(t.db,'s','reservation_created',1,true)]);
  expect(results.filter(Boolean)).toHaveLength(1);expect(count('scenarios')).toBe(1);expect(count('scenario_steps')).toBe(1);
 });
 it('seedを繰り返しても既存の本文・時期・停止状態・承認を上書きしない',async()=>{
  const first=await enable();t.raw.prepare("UPDATE scenario_steps SET message_content='編集した本文' WHERE id=?").run(first.step_id);
  t.raw.exec('UPDATE rt_store_followup_step_bindings SET offset_minutes=55');await approve();
  const before=t.raw.prepare('SELECT * FROM rt_store_followup_templates').get();
  const beforeRows=t.raw.prepare('SELECT * FROM rt_store_followup_rows ORDER BY trigger').all();
  await readRestaurantFollowupRows(t.db,'s');await readRestaurantFollowupRows(t.db,'s');
  expect(t.raw.prepare('SELECT * FROM rt_store_followup_templates').get()).toEqual(before);
  expect(t.raw.prepare('SELECT * FROM rt_store_followup_rows ORDER BY trigger').all()).toEqual(beforeRows);
  expect(t.raw.prepare('SELECT offset_minutes FROM rt_store_followup_step_bindings').get()).toEqual({offset_minutes:55});
  expect(t.raw.prepare('SELECT message_content FROM scenario_steps').get()).toEqual({message_content:'編集した本文'});
 });
 it.each(['scenarios','rt_store_followup_templates','scenario_steps','rt_store_followup_step_bindings','rt_store_followup_rows'])('%sで途中故障しても本体を残さず、再試行で作れる',async table=>{
  await readRestaurantFollowupRows(t.db,'s');
  t.raw.exec(`CREATE TRIGGER fixture_failure BEFORE ${table==='rt_store_followup_rows'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture_failure'); END`);
  await expect(setRestaurantFollowupRow(t.db,'s','reservation_created',1,true)).rejects.toThrow('fixture_failure');
  expect(count('scenarios')).toBe(0);expect(count('scenario_steps')).toBe(0);expect(count('rt_store_followup_step_bindings')).toBe(0);
  expect(t.raw.prepare("SELECT step_id,version FROM rt_store_followup_rows WHERE trigger='reservation_created'").get()).toEqual({step_id:null,version:1});
  t.raw.exec('DROP TRIGGER fixture_failure');expect(await enable()).toBeTruthy();
 });
});
describe('記念日の現地時刻と承認',()=>{
 it.each([
  ['Asia/Tokyo','2000-01-03',-10080,'09:30','2026-12-27T00:30:00.000Z'],
  ['America/New_York','2000-03-12',-10080,'10:00','2026-03-05T15:00:00.000Z'],
  ['America/New_York','2000-03-09',-1440,'02:30','2026-03-08T07:30:00.000Z'],
  ['America/New_York','2000-11-02',-1440,'01:30','2026-11-01T05:30:00.000Z'],
  ['Asia/Tokyo','2000-02-29',-1440,'11:45','2027-02-27T02:45:00.000Z'],
 ])('%s の暦で引き算し、承認前0・承認後1回・日付変更で取消',async(timezone,date,offset,time,at)=>{
  await enable('anniversary_before');
  t.raw.prepare('UPDATE rt_stores SET timezone=?').run(timezone);
  t.raw.prepare('UPDATE rt_store_followup_step_bindings SET offset_minutes=?,anniversary_time=?').run(offset,time);
  t.raw.prepare("INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','fixed-anniversary',?)").run(date);
  const now=new Date(at);await scheduleRestaurantAnniversaries(t.db,now);expect(count('scenario_source_jobs')).toBe(0);
  await approve();await scheduleRestaurantAnniversaries(t.db,now);await scheduleRestaurantAnniversaries(t.db,now);
  expect(count('scenario_source_jobs')).toBe(1);
  const job=t.raw.prepare('SELECT * FROM scenario_source_jobs').get() as ScenarioSourceJob;
  expect(job.scheduled_at).toBe(at);expect(await restaurantAnniversaryState(t.db,job,now)).not.toBeNull();
  t.raw.exec("UPDATE friend_field_values SET value='2000-06-15'");expect(await restaurantAnniversaryState(t.db,job,now)).toBeNull();
 });
});

it('オンと公開・承認申請まででは送信0、承認した版だけを使う', async()=>{
 await enable('anniversary_before');
 t.raw.exec("INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','fixed-anniversary','2000-10-18')");
 const template=t.raw.prepare('SELECT * FROM rt_store_followup_templates').get() as any;
 expect(template.sending_status).toBe('stopped');
 expect(await requestRestaurantFollowupApproval(t.db,'s',template.template_version,'owner')).toBeNull();
 await publishScenarioVersion(t.db,template.scenario_id,{staffId:'owner',idempotencyKey:crypto.randomUUID()});
 const version=(t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as any).template_version;
 const approval=(await requestRestaurantFollowupApproval(t.db,'s',version,'owner'))!;
 expect(approval).not.toBeNull();
 const now=new Date('2026-10-11T01:00:00Z');
 await scheduleRestaurantAnniversaries(t.db,now);expect(count('scenario_source_jobs')).toBe(0);
 t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(approval.id);
 await scheduleRestaurantAnniversaries(t.db,now);expect(count('scenario_source_jobs')).toBe(1);
});

it('結びを削除してから再オンしても元の本文を再利用して一歩を増やさない',async()=>{
 const first=await enable();t.raw.prepare("UPDATE scenario_steps SET message_content='残す本文' WHERE id=?").run(first.step_id);
 t.raw.exec("DELETE FROM rt_store_followup_step_bindings WHERE trigger='reservation_created'");
 const next=await enable();expect(next.step_id).toBe(first.step_id);expect(count('scenario_steps')).toBe(1);
 expect(t.raw.prepare('SELECT message_content FROM scenario_steps').get()).toEqual({message_content:'残す本文'});
});
it('本体のない管理対象も旧予約通知と旧待ち通知を送らず、旧本文の編集を拒む',async()=>{
 const starts=new Date(Date.now()+180*60000).toISOString(),ends=new Date(Date.now()+240*60000).toISOString();
 t.raw.prepare("INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status) VALUES('r','s','line','友だち','UID',2,?,?,'confirmed')").run(starts,ends);
 t.raw.exec("INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('notice','s','r',1,'UID','旧通知','retry')");
 expect(t.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='notice'").get()).toEqual({valid:0});
 t.raw.prepare("INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,line_uid,identity_key,status) VALUES('w','s',?,?,2,'友だち','UID','uid','waiting')").run(starts,ends);
 t.raw.prepare("UPDATE rt_seat_waitlist SET status='invited',invited_at=?,hold_expires_at=?,notification_retry_key='wait-retry' WHERE id='w'").run(new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
 const env={DB:t.db,DEPLOY_ENV:'test',RESTAURANT_TEST_ENABLED:'true'} as Env['Bindings'];
 await dispatchWaitlistInvites(env,'a');expect(legacySend).not.toHaveBeenCalled();
 expect(count('scenario_source_jobs')).toBe(0);expect(count('rt_store_followup_templates')).toBe(0);
 t.raw.exec("INSERT INTO rt_line_flows(id,organization_id,store_id,flow_type,title,body) VALUES('flow','o','s','reservation_24h','旧','旧本文')");
 expect(()=>t.raw.exec("UPDATE rt_line_flows SET body='変更' WHERE id='flow'")).toThrow('edit_restaurant_followup_in_common_scenario');
 // 管理の印が無い既存経路には、今回の切替判定を広げない。
 t.raw.exec('DELETE FROM rt_store_followup_rows');
 await dispatchWaitlistInvites(env,'a');expect(legacySend).toHaveBeenCalledTimes(1);
 expect(()=>t.raw.exec("UPDATE rt_line_flows SET body='変更' WHERE id='flow'")).not.toThrow();
 t.raw.exec("DELETE FROM rt_customer_notice_outbox WHERE id='notice'");
 t.raw.exec("INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('old-notice','s','r',1,'UID','旧通知','old-retry')");
 expect(t.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='old-notice'").get()).toEqual({valid:1});
});
