import { reservationInstant } from '@line-crm/shared';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { setRestaurantAttendance } from './restaurant-attendance.js';
import { publishScenarioVersion } from '@line-crm/db';
import { requestRestaurantFollowupApproval,scheduleRestaurantFollowup } from './restaurant-followup.js';
import { processScenarioSourceJobs, type SourceJobSend } from '../features/scenarios/scenario-source-jobs.js';
import { respondToRestaurantConfirmation } from './restaurant-confirmations.js';
import type { RestaurantEvent } from './restaurant-event-types.js';
import type { Env } from '../worker-env.js';
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:vi.fn(async()=>true)}));
let t:SqliteD1,env:Env['Bindings'];
const sender=vi.fn<SourceJobSend>(async()=>{});
const store='s',scenario='restaurant-followup:s';
function iso(offset:number){return new Date(Date.now()+offset*60000).toISOString();}
function reservation(id='r',starts=iso(3000),source='phone',occurredAt?:string) {
 t.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
 VALUES(?,'s',?,'友だち','UID',2,?,?,'confirmed')`).run(id,source,starts,new Date(Date.parse(reservationInstant(starts))+120*60000).toISOString());
 // SQLiteのstrftime('now')はJavaScriptの偽時計と別。固定時刻の試験ではイベントも同じ時刻で作る。
 if(occurredAt !== undefined) t.raw.prepare('UPDATE rt_reservation_events SET occurred_at=? WHERE reservation_id=?').run(occurredAt,id);
 return t.raw.prepare('SELECT * FROM rt_reservation_events WHERE reservation_id=? ORDER BY reservation_version DESC LIMIT 1').get(id) as RestaurantEvent;
}
async function activate() {
 await publishScenarioVersion(t.db,scenario,{staffId:'owner',idempotencyKey:crypto.randomUUID()});
 const version=(t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as {template_version:number}).template_version;
 const approval=await requestRestaurantFollowupApproval(t.db,store,version,'owner');expect(approval).not.toBeNull();
 t.raw.prepare("UPDATE rt_approval_requests SET status='approved',reviewed_by='owner' WHERE id=?").run(approval!.id);
 return approval!.id;
}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-11T09:00:00Z'));
 t=createTestD1({now:()=>new Date()});sender.mockClear();
 t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','token','secret');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','o','店舗','S','a');`);
 env={DB:t.db,DEPLOY_ENV:'test',RESTAURANT_TEST_ENABLED:'true',WORKER_PUBLIC_URL:'https://worker.invalid'} as Env['Bindings'];
});
afterEach(()=>{vi.useRealTimers();t.raw.close();});
describe('飲食3・承認した共通版と予約ごとの送り方',()=>{
 it('複数吹き出しを公開版へ固定し、テキストとカルーセルを1回の送信で同じ順に送る',async()=>{
  const step='restaurant-followup:s:reservation_created';
  const bubbles=[{id:'text',type:'text',content:{text:'{{name}}さん、{{var.guest_count}}名のご予約を承りました。'}},
   {id:'carousel',type:'carousel',content:{columnsJson:JSON.stringify([{text:'{{var.store_name}}のご案内',actions:[{type:'uri',label:'地図',uri:'https://example.test/map'}]}])}}];
  t.raw.prepare('UPDATE scenario_steps SET message_bubbles_json=? WHERE id=?').run(JSON.stringify(bubbles),step);
  await activate();
  const first=(t.raw.prepare('SELECT approved_version_id id FROM rt_store_followup_templates').get() as {id:string}).id;
  const snapshot=(t.raw.prepare('SELECT steps_snapshot FROM scenario_versions WHERE id=?').get(first) as {steps_snapshot:string}).steps_snapshot;
  expect(JSON.parse(snapshot).find((s:any)=>s.live_step_id===step).message_bubbles_json).toBe(JSON.stringify(bubbles));
  const event=reservation();await scheduleRestaurantFollowup(t.db,event);expect(await processScenarioSourceJobs(env,sender)).toBe(1);
  expect(sender).toHaveBeenCalledTimes(1);
  const messages=(sender.mock.calls[0] as unknown[])[2] as any[];
  expect(messages.map(m=>m.type)).toEqual(['text','template']);expect(messages[0].text).toBe('友だちさん、2名のご予約を承りました。');
  expect(messages[1].template.columns[0].text).toBe('店舗のご案内');
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  bubbles[0].content.text='改稿';t.raw.prepare('UPDATE scenario_steps SET message_bubbles_json=? WHERE id=?').run(JSON.stringify(bubbles),step);
  expect(t.raw.prepare('SELECT sending_status FROM rt_store_followup_templates').get()).toEqual({sending_status:'stopped'});
  expect((t.raw.prepare('SELECT steps_snapshot FROM scenario_versions WHERE id=?').get(first) as {steps_snapshot:string}).steps_snapshot).toBe(snapshot);
  await activate();expect((t.raw.prepare('SELECT approved_version_id id FROM rt_store_followup_templates').get() as {id:string}).id).not.toBe(first);
 });
 it('店の追加は下書き・停止、再接続でひな形を二重作成しない',()=>{
  expect(t.raw.prepare('SELECT sending_status,approved_version_id FROM rt_store_followup_templates').get()).toEqual({sending_status:'stopped',approved_version_id:null});
  t.raw.exec("UPDATE rt_stores SET line_account_id='a' WHERE id='s'");
  expect(t.raw.prepare('SELECT COUNT(*) n FROM scenarios').get()).toEqual({n:1});
  expect(t.raw.prepare('SELECT COUNT(*) n FROM scenario_steps').get()).toEqual({n:7});
 });
 it('下書き・未承認は送信0、承認後の電話予約だけ同じ版で送る',async()=>{
  const e=reservation();await scheduleRestaurantFollowup(t.db,e);expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  await publishScenarioVersion(t.db,scenario,{staffId:'owner',idempotencyKey:'publish'});
  const version=(t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as {template_version:number}).template_version;
  const a=await requestRestaurantFollowupApproval(t.db,store,version,'owner');
  await scheduleRestaurantFollowup(t.db,e);expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(a!.id);
  await scheduleRestaurantFollowup(t.db,e);expect(await processScenarioSourceJobs(env,sender)).toBe(1);
  expect(sender).toHaveBeenCalledTimes(1);
  expect((sender.mock.calls[0] as unknown[])[2]).toEqual([{type:'text',text:'予約が入りました。'}]);
  expect(t.raw.prepare('SELECT scenario_version_id FROM scenario_source_jobs LIMIT 1').get()).toEqual({scenario_version_id:(t.raw.prepare('SELECT current_published_version_id id FROM scenarios').get() as {id:string}).id});
 });
 it('仮押さえでは送らず、確定への更新で予約入りと前日確認を一度だけ作る',async()=>{
  await activate();
  t.raw.prepare("INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status,hold_expires_at) VALUES('r','s','line','友だち','UID',2,?,?,'pending',?)").run(iso(3000),iso(3120),iso(10));
  expect(t.raw.prepare("SELECT COUNT(*) n FROM rt_reservation_events WHERE reservation_id='r'").get()).toEqual({n:0});
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  t.raw.exec("UPDATE rt_reservations SET status='confirmed',customer_version=customer_version+1,hold_expires_at=NULL WHERE id='r'");
  const e=t.raw.prepare("SELECT * FROM rt_reservation_events WHERE reservation_id='r'").get() as RestaurantEvent;
  expect(e.event_type).toBe('restaurant.reservation.created');expect(e.reservation_version).toBe(2);
  t.raw.exec("INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('n','s','r',2,'UID','旧文','key')");
  expect(t.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='n'").get()).toEqual({valid:0});
  await scheduleRestaurantFollowup(t.db,e);await scheduleRestaurantFollowup(t.db,e);
  expect(t.raw.prepare("SELECT COUNT(*) n FROM scenario_source_jobs WHERE source_id='r'").get()).toEqual({n:3});
  expect(await processScenarioSourceJobs(env,sender)).toBe(1);expect(sender).toHaveBeenCalledTimes(1);
 });
 it('同じ人の2予約を別ジョブにし、競争・再実行でも予約入りを1回ずつ送る',async()=>{
  await activate();const a=reservation('r1'),b=reservation('r2',iso(4500));
  await scheduleRestaurantFollowup(t.db,a);await scheduleRestaurantFollowup(t.db,b);await scheduleRestaurantFollowup(t.db,a);
  const counts=await Promise.all([processScenarioSourceJobs(env,sender),processScenarioSourceJobs(env,sender)]);
  expect(counts.reduce((a,b)=>a+b,0)).toBe(2);expect(sender).toHaveBeenCalledTimes(2);
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
 });
 it('失敗後は同じretry keyでやり直し、成功後は再送しない',async()=>{
  await activate();await scheduleRestaurantFollowup(t.db,reservation());
  sender.mockRejectedValueOnce(new Error('timeout'));
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  const key=(t.raw.prepare("SELECT idempotency_key FROM scenario_source_jobs WHERE status='failed'").get() as {idempotency_key:string}).idempotency_key;
  t.raw.exec("UPDATE scenario_source_jobs SET lease_until=NULL WHERE status='failed'");
  expect(await processScenarioSourceJobs(env,sender)).toBe(1);
  expect((sender.mock.calls[1] as unknown[])[1]).toMatchObject({idempotency_key:key});
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
 });
 it('応答喪失の仕事を新しい承認版・別のretry keyで送り直さない',async()=>{
  await activate();const e=reservation();await scheduleRestaurantFollowup(t.db,e);
  sender.mockRejectedValueOnce(new Error('response_lost'));await processScenarioSourceJobs(env,sender);
  t.raw.exec("UPDATE scenario_steps SET message_content='新しい案内' WHERE scenario_id='restaurant-followup:s' AND step_order=0");await activate();
  await scheduleRestaurantFollowup(t.db,e);
  expect(t.raw.prepare("SELECT COUNT(*) n FROM scenario_source_jobs WHERE source_id='r' AND attempt_count>0").get()).toEqual({n:1});
  expect(t.raw.prepare("SELECT COUNT(*) n FROM scenario_source_jobs j JOIN scenario_versions v ON v.id=j.scenario_version_id JOIN json_each(v.steps_snapshot) st ON json_extract(st.value,'$.version_step_id')=j.step_id WHERE json_extract(st.value,'$.live_step_id') LIKE '%:reservation_created'").get()).toEqual({n:1});
  t.raw.exec("UPDATE scenario_source_jobs SET lease_until=NULL WHERE status='failed'");
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);expect(sender).toHaveBeenCalledTimes(1);
 });
 it('承認後に共通編集・時刻・公開版を変えたら旧承認で送らない',async()=>{
  const approval=await activate();await scheduleRestaurantFollowup(t.db,reservation());
  t.raw.exec("UPDATE scenario_steps SET message_content='改稿' WHERE scenario_id='restaurant-followup:s' AND step_order=0");
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);expect(sender).not.toHaveBeenCalled();
  expect(()=>t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(approval)).toThrow(/version_conflict/);
 });
 it('停止・ブロック・別店所属・取消・予定変更は送信0',async()=>{
  await activate();const e=reservation();await scheduleRestaurantFollowup(t.db,e);
  t.raw.exec("UPDATE friends SET is_following=0 WHERE id='f'");expect(await processScenarioSourceJobs(env,sender)).toBe(0);
  expect(sender).not.toHaveBeenCalled();
 });
 it.each(['stop','blocked','other_account','cancel','schedule'] as const)('%sでは送り先や予定の変更を追い越さない',async action=>{
  await activate();await scheduleRestaurantFollowup(t.db,reservation());
  if(action==='stop')t.raw.exec("UPDATE rt_store_followup_templates SET sending_status='stopped'");
  if(action==='blocked')t.raw.exec("UPDATE friends SET is_following=0 WHERE id='f'");
  if(action==='other_account')t.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','別店','t','s');UPDATE friends SET line_account_id='b' WHERE id='f'");
  if(action==='cancel')t.raw.exec("UPDATE rt_reservations SET status='cancelled' WHERE id='r'");
  if(action==='schedule')t.raw.prepare("UPDATE rt_reservations SET starts_at=?,ends_at=? WHERE id='r'").run(iso(4000),iso(4120));
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);expect(sender).not.toHaveBeenCalled();
 });
 it('待ちの期限と既存のretry keyを保ち、共通の案内だけを送る',async()=>{
  env.LIFF_URL='https://liff.line.me/test-liff';await activate();
  t.raw.prepare("INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,line_uid,identity_key,status) VALUES('w','s',?,?,2,'友だち','UID','uid','waiting')").run(iso(120),iso(240));
  const key=crypto.randomUUID();t.raw.prepare("UPDATE rt_seat_waitlist SET status='invited',invited_at=?,hold_expires_at=?,notification_retry_key=? WHERE id='w'").run(iso(0),iso(30),key);
  const e=t.raw.prepare("SELECT * FROM rt_reservation_events WHERE event_type='restaurant.waitlist.invited'").get() as RestaurantEvent;
  await scheduleRestaurantFollowup(t.db,e);
  expect(await processScenarioSourceJobs(env,sender)).toBe(1);expect(sender).toHaveBeenCalledTimes(1);
  expect((sender.mock.calls[0] as unknown[])[1]).toMatchObject({idempotency_key:key});
  expect(JSON.stringify(sender.mock.calls)).toContain('/booking?seat_waitlist=w');
  expect(t.raw.prepare("SELECT notified_at FROM rt_seat_waitlist WHERE id='w'").get()).not.toEqual({notified_at:null});
  expect(await processScenarioSourceJobs(env,sender)).toBe(0);
 });
 it('承認待ちに編集した申請は開始できず、時刻変更も再承認になる',async()=>{
  await publishScenarioVersion(t.db,scenario,{staffId:'owner',idempotencyKey:'first'});
  const version=(t.raw.prepare('SELECT template_version FROM rt_store_followup_templates').get() as {template_version:number}).template_version;
  const a=await requestRestaurantFollowupApproval(t.db,'s',version,'owner');
  t.raw.exec("UPDATE rt_store_followup_step_bindings SET offset_minutes=-1500,version=version+1 WHERE trigger='reservation_24h'");
  expect(()=>t.raw.prepare("UPDATE rt_approval_requests SET status='approved' WHERE id=?").run(a!.id)).toThrow(/version_conflict/);
  expect(t.raw.prepare('SELECT sending_status FROM rt_store_followup_templates').get()).toEqual({sending_status:'stopped'});
 });
 it('取消の返事は期限・在庫・予約版・結果通知を同じ書込で守り再試行で増やさない',async()=>{
  reservation();t.raw.exec("INSERT INTO booking_settings(id,line_account_id,cancel_deadline_minutes_before) VALUES('bs','a',60)");
  const id=crypto.randomUUID();t.raw.prepare('INSERT INTO rt_reservation_confirmations(request_id,reservation_id,reservation_version,friend_id,requested_at,expires_at) VALUES(?,?,1,?,?,?)').run(id,'r','f',iso(0),iso(3000));
  const input={requestId:id,friendId:'f',accountId:'a',expectedVersion:1,response:'cancel' as const};
  expect(await respondToRestaurantConfirmation(t.db,input)).toEqual({ok:true,response:'cancel',version:2});
  expect(await respondToRestaurantConfirmation(t.db,input)).toEqual({ok:true,response:'cancel',version:2});
  expect(t.raw.prepare('SELECT COUNT(*) n FROM rt_customer_notice_outbox').get()).toEqual({n:1});
  expect(t.raw.prepare('SELECT response FROM rt_reservation_confirmations').get()).toEqual({response:'cancel'});
  expect(t.raw.prepare('SELECT status,customer_version FROM rt_reservations').get()).toEqual({status:'cancelled',customer_version:2});
 });
 it('変更したいは日時を変えず記録し、違う返事・期限後・取消期限後を拒否する',async()=>{
  const e=reservation();t.raw.exec("INSERT INTO booking_settings(id,line_account_id,cancel_deadline_minutes_before) VALUES('bs','a',4000)");
  const id=crypto.randomUUID();t.raw.prepare('INSERT INTO rt_reservation_confirmations(request_id,reservation_id,reservation_version,friend_id,requested_at,expires_at) VALUES(?,?,1,?,?,?)').run(id,'r','f',iso(0),iso(3000));
  const input={requestId:id,friendId:'f',accountId:'a',expectedVersion:1,response:'cancel' as const};
  expect(await respondToRestaurantConfirmation(t.db,input)).toMatchObject({ok:false,error:'self_deadline_passed',status:403});
  expect(await respondToRestaurantConfirmation(t.db,{...input,response:'change_requested'})).toEqual({ok:true,response:'change_requested',version:1});
  expect(await respondToRestaurantConfirmation(t.db,{...input,response:'going'})).toMatchObject({ok:false,error:'response_conflict'});
  expect(JSON.parse(e.payload_json).startsAt).toBe((t.raw.prepare('SELECT starts_at FROM rt_reservations').get() as {starts_at:string}).starts_at);
  t.raw.exec("UPDATE rt_reservation_confirmations SET response=NULL,expires_at='2000-01-01T00:00:00Z'");
  expect(await respondToRestaurantConfirmation(t.db,{...input,response:'going'})).toMatchObject({ok:false,error:'confirmation_expired'});
 });
 it('LIFFの新しい確定通知は共通の行だけ。変更・取消の結果通知は残す',async()=>{
  await activate();const e=reservation('r',iso(3000),'line');
  t.raw.exec("INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('n','s','r',1,'UID','旧確定文','old')");
  expect(t.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='n'").get()).toEqual({valid:0});
  await scheduleRestaurantFollowup(t.db,e);expect(await processScenarioSourceJobs(env,sender)).toBe(1);
  t.raw.exec("UPDATE rt_reservations SET note='補足' WHERE id='r'; INSERT INTO rt_customer_notice_outbox(id,store_id,reservation_id,customer_version,line_uid,message,retry_key) VALUES('change','s','r',2,'UID','変更','change')");
  expect(t.raw.prepare("SELECT valid FROM rt_customer_notice_outbox WHERE id='change'").get()).toEqual({valid:1});
 });
 it('直接受付も予約入り、お礼と口コミは実退店起点で全員同じ行',async()=>{
  await activate();const e=reservation('r',iso(0),'walk_in');await scheduleRestaurantFollowup(t.db,e);
  expect(await processScenarioSourceJobs(env,sender)).toBe(1);
  await setRestaurantAttendance(t.db,'r','s',{action:'visited',expectedVersion:1,requestId:'visit'},null,null);
  await setRestaurantAttendance(t.db,'r','s',{action:'depart',expectedVersion:2,requestId:'depart'},null,null);
  const departed=t.raw.prepare("SELECT * FROM rt_reservation_events WHERE event_type='restaurant.departed'").get() as RestaurantEvent;
  await scheduleRestaurantFollowup(t.db,departed);
  const jobs=t.raw.prepare("SELECT j.scheduled_at,b.trigger FROM scenario_source_jobs j JOIN scenario_versions v ON v.id=j.scenario_version_id JOIN json_each(v.steps_snapshot) step ON json_extract(step.value,'$.version_step_id')=j.step_id JOIN rt_store_followup_step_bindings b ON b.step_id=json_extract(step.value,'$.live_step_id') WHERE b.trigger IN('post_visit','review_request') ORDER BY b.trigger").all();
  expect(jobs).toHaveLength(2);
  expect(Date.parse((jobs[0] as {scheduled_at:string}).scheduled_at)-Date.parse(departed.occurred_at)).toBeCloseTo(180*60000,-3);
 });
 it('来店確認カードは予約版を持ち、行きますは予約を改版しない',async()=>{
  await activate();await scheduleRestaurantFollowup(t.db,reservation());
  t.raw.prepare('UPDATE scenario_source_jobs SET scheduled_at=?').run(iso(0));
  await processScenarioSourceJobs(env,sender);
  const c=t.raw.prepare('SELECT * FROM rt_reservation_confirmations').get() as {request_id:string;reservation_version:number};expect(c.reservation_version).toBe(1);
  const rendered=JSON.stringify(sender.mock.calls);expect(rendered).toContain('rc:'+c.request_id+':going');expect(rendered).not.toContain('{{var.restaurant_');
  const card=sender.mock.calls.map(call=>(call as unknown[])[2] as {type:string;contents?:unknown}[]).flat().find(message=>message.type==='flex');
  expect(card).toMatchObject({type:'flex',contents:{type:'bubble'}});
  const result=await respondToRestaurantConfirmation(t.db,{requestId:c.request_id,friendId:'f',accountId:'a',expectedVersion:1,response:'going'});
  expect(result).toEqual({ok:true,response:'going',version:1});
 });
 it('古い版・別の人・変更したい・取消の期限と再試行を守る',async()=>{
  reservation();const id=crypto.randomUUID();
  t.raw.prepare('INSERT INTO rt_reservation_confirmations(request_id,reservation_id,reservation_version,friend_id,requested_at,expires_at) VALUES(?,?,1,?,?,?)').run(id,'r','f',iso(0),iso(2000));
  const input={requestId:id,friendId:'f',accountId:'a',expectedVersion:1,response:'change_requested' as const};
  expect(await respondToRestaurantConfirmation(t.db,{...input,friendId:'someone'})).toMatchObject({ok:false,status:404});
  t.raw.exec("UPDATE rt_reservations SET note='新版' WHERE id='r'");
  expect(await respondToRestaurantConfirmation(t.db,input)).toMatchObject({ok:false,error:'version_conflict'});
  expect(t.raw.prepare('SELECT response FROM rt_reservation_confirmations').get()).toEqual({response:null});
 });
 const boundaries=[
  {jst:'00:09',now:'2026-10-11T15:09:00Z',next:'2026-10-13 00:09'},
  {jst:'08:59',now:'2026-10-11T23:59:00Z',next:'2026-10-13 08:59'},
  {jst:'09:00',now:'2026-10-12T00:00:00Z',next:'2026-10-13 09:00'},
  {jst:'23:59',now:'2026-10-12T14:59:00Z',next:'2026-10-13 23:59'},
 ];
 it.each(boundaries)('旧SQLiteのUTC時刻を端末の時間帯でずらさない（$jst JST）',async({now,next})=>{
  vi.setSystemTime(new Date(now));await activate();
  const starts=iso(1440).replace('T',' ').slice(0,19);
  const e=reservation('r',starts,'phone',new Date(now).toISOString());await scheduleRestaurantFollowup(t.db,e);
  const due=t.raw.prepare("SELECT scheduled_at FROM scenario_source_jobs j JOIN scenario_versions v ON v.id=j.scenario_version_id JOIN json_each(v.steps_snapshot) st ON json_extract(st.value,'$.version_step_id')=j.step_id WHERE json_extract(st.value,'$.live_step_id') LIKE '%:reservation_24h'").get() as {scheduled_at:string};
  expect(due.scheduled_at).toBe(new Date(now).toISOString());
  expect(await processScenarioSourceJobs(env,sender)).toBe(2);
  expect(JSON.stringify(sender.mock.calls)).toContain(next);
 });
 it.each(boundaries)('$jst JSTでも予約時刻の24時間前・本文の今日を日本時間で扱う',async({now})=>{
  vi.setSystemTime(new Date(now));await activate();
  t.raw.exec("UPDATE scenario_steps SET message_content='{{date}}・{{var.reservation_datetime}}' WHERE scenario_id='restaurant-followup:s' AND step_order=0");await activate();
  const starts=iso(1440);await scheduleRestaurantFollowup(t.db,reservation('r',starts,'phone',new Date().toISOString()));
  const before=t.raw.prepare("SELECT j.scheduled_at FROM scenario_source_jobs j JOIN scenario_versions v ON v.id=j.scenario_version_id JOIN json_each(v.steps_snapshot) st ON json_extract(st.value,'$.version_step_id')=j.step_id WHERE json_extract(st.value,'$.live_step_id') LIKE '%:reservation_24h'").get() as {scheduled_at:string};
  expect(Date.parse(starts)-Date.parse(before.scheduled_at)).toBe(24*60*60000);
  expect(before.scheduled_at).toBe(new Date(now).toISOString());
  expect(await processScenarioSourceJobs(env,sender)).toBe(2);
  expect(JSON.stringify(sender.mock.calls)).toContain('10月12日(月)');
 });
});

it('組5: 記念日の7日前の行は停止で作られ、承認済みの固定版だけを年に1回送る',async()=>{
 const row=t.raw.prepare("SELECT step_id,offset_minutes,enabled FROM rt_store_followup_step_bindings WHERE trigger='anniversary_before'").get() as {step_id:string;offset_minutes:number;enabled:number};
 expect(row).toMatchObject({offset_minutes:-10080,enabled:0});
 t.raw.prepare("INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','fixed-anniversary','2000-10-18')").run();
 t.raw.exec("UPDATE rt_store_followup_step_bindings SET enabled=1 WHERE trigger='anniversary_before'");
 // At 18:00 JST the 10:00 send is due, still inside the existing 24-hour retry window.
 expect(await processScenarioSourceJobs(env,sender)).toBe(0);
 await activate();expect(await processScenarioSourceJobs(env,sender)).toBe(1);
 expect(sender.mock.calls[0][2]).toMatchObject([{type:'text',text:'もうすぐ記念日ですね。ご来店をお待ちしています。'}]);
 expect(await processScenarioSourceJobs(env,sender)).toBe(0);expect(sender).toHaveBeenCalledTimes(1);
 const jobs=t.raw.prepare("SELECT * FROM scenario_source_jobs WHERE source_kind='restaurant_anniversary'").all();expect(jobs).toHaveLength(1);
});

it('組5: 予約した記念日が変わった場合は送信直前に再確認して古い案内を止める',async()=>{
 t.raw.exec("UPDATE rt_store_followup_step_bindings SET enabled=1 WHERE trigger='anniversary_before';INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','fixed-anniversary','2000-10-18')");
 await activate();
 const {scheduleRestaurantAnniversaries,restaurantAnniversaryState}=await import('./restaurant-anniversary-followup.js');
 await scheduleRestaurantAnniversaries(t.db);
 const job=t.raw.prepare("SELECT * FROM scenario_source_jobs WHERE source_kind='restaurant_anniversary'").get() as import('../features/scenarios/scenario-source-jobs.js').ScenarioSourceJob;
 expect(await restaurantAnniversaryState(t.db,job)).not.toBeNull();
 t.raw.exec("UPDATE friend_field_values SET value='2000-11-18' WHERE friend_id='f' AND field_id='fixed-anniversary'");
 expect(await restaurantAnniversaryState(t.db,job)).toBeNull();expect(await processScenarioSourceJobs(env,sender)).toBe(0);
 expect(t.raw.prepare('SELECT status FROM scenario_source_jobs WHERE id=?').get(job.id)).toEqual({status:'cancelled'});
});
