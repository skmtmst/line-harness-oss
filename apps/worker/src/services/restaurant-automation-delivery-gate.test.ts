import { runAutomationTest } from '../features/automations/automation-definitions.js';
import { automationRevisionToken } from '../features/automations/automation-drafts.js';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { startAutomationRun,processAutomationRun,processDueAutomationRuns } from '../features/automations/automation-engine.js';
import { createAutomationActionExecutors } from '../features/automations/automation-action-executors.js';
import { readFollowupEngineSnapshot } from './restaurant-followup-engine-approval.js';
import type { RestaurantEvent } from './restaurant-event-types.js';
let t:SqliteD1;
const startAt='2026-11-02T11:30:00.000Z',resumeAt='2026-11-03T01:00:00.000Z';
beforeEach(()=>{
 t=createTestD1();t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店舗','t','s');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id,timezone) VALUES('store','org','食堂','S','a','Asia/Tokyo');
 INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
 VALUES('r','store','line','友だち','UID',4,'2026-11-02T09:00:00Z','2026-11-02T11:00:00Z','confirmed'),
 ('other','store','line','友だち','UID',2,'2026-11-01T09:00:00Z','2026-11-01T11:00:00Z','confirmed');
 INSERT INTO rt_seat_visit_marks(id,reservation_id,store_id,kind,marked_at) VALUES('visit','r','store','visited','2026-11-02T10:00:00Z');
 UPDATE rt_reservations SET status='visited',departed_at='2026-11-02T11:30:00Z',customer_version=customer_version+1 WHERE id='r';
 UPDATE rt_reservation_events SET occurred_at='2026-11-02T11:30:00Z' WHERE event_type='restaurant.departed';`);
});
afterEach(()=>t.raw.close());
async function definition(managed=false,template=false){
 if(template)t.raw.exec("INSERT INTO templates(id,line_account_id,name,message_type,message_content,published_version) VALUES('tpl','a','お礼','text','承認したお礼',1)");
 const actions=[{id:'wait',type:'wait',params:{mode:'next_day',sendAtTime:'10:00'},onFailure:'stop'},
 {id:'send',type:'send_message',params:template?{templateId:'tpl'}:{content:'{{reservation_datetime}} {{var.guest_count}}名 {{var.store_name}}'},onFailure:'stop'}];
 t.raw.exec("INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES('auto','a','お礼','active')");
 t.raw.prepare("INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config) VALUES('v','auto',1,'published','restaurant.departed',?)").run(JSON.stringify(actions));
 t.raw.exec("UPDATE automation_definitions SET current_published_version_id='v' WHERE id='auto'");
 if(managed){
 const snapshot=await readFollowupEngineSnapshot(t.db,{engine:'automation',targetId:'auto',lineAccountId:'a',storeId:'store'});
 t.raw.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json) VALUES('approval','org','store','line_message','開始','approved',?)`)
 .run(JSON.stringify({operation:'start_restaurant_followup_engines',lineAccountId:'a',targets:[{trigger:'post_visit',engine:'automation',targetId:'auto',versionId:'v',contentHash:snapshot!.contentHash}]}));
 t.raw.prepare(`INSERT INTO rt_store_followup_targets(store_id,trigger,engine,automation_id,enabled,sending_status,approved_version_id,approved_content_hash,approval_id)
 VALUES('store','post_visit','automation','auto',1,'active','v',?,'approval')`).run(snapshot!.contentHash);
 }
}
async function start(){const e=t.raw.prepare("SELECT * FROM rt_reservation_events WHERE event_type='restaurant.departed'").get() as RestaurantEvent;
 return startAutomationRun(t.db,{lineAccountId:'a',automationId:'auto',friendId:'f',sourceEventId:e.id,idempotencyKey:'event',inputEvent:{type:e.event_type},conditionMatched:true,now:startAt});}
function executors(onToken?:()=>void){const push=vi.fn(async()=>({}));return {push,executors:createAutomationActionExecutors({now:()=>resumeAt,
 resolveLineAccessToken:async()=>{onToken?.();return 'token';},createLineClient:()=>({pushMessage:push,linkRichMenuToUser:vi.fn(),unlinkRichMenuFromUser:vi.fn()})})};}
function invalidate(kind:string){
 if(kind==='undo')t.raw.exec("UPDATE rt_reservations SET departed_at=NULL,customer_version=customer_version+1 WHERE id='r'");
 else if(kind==='changed')t.raw.exec("UPDATE rt_reservations SET guest_count=5,customer_version=customer_version+1 WHERE id='r'");
 else if(kind==='cancelled'||kind==='no_show'){
 t.raw.exec("UPDATE rt_reservations SET departed_at=NULL,customer_version=customer_version+1 WHERE id='r'");
 t.raw.prepare("UPDATE rt_reservations SET status=?,customer_version=customer_version+1 WHERE id='r'").run(kind);
 }else if(kind==='approval')t.raw.exec("UPDATE rt_approval_requests SET status='pending'");
 else if(kind==='template')t.raw.exec("UPDATE templates SET message_content='別の未承認本文'");
}
it('通常の飲食オートメーションも、対象予約を差し込んで翌日1回だけ送る',async()=>{
 await definition();const run=await start(),e=executors();expect(run.runId).toBeTruthy();
 expect(await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors})).toBe('waiting');
 await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});
 expect(e.push).toHaveBeenCalledTimes(1);expect(JSON.stringify(e.push.mock.calls)).toContain('2026-11-02 18:00 4名 食堂');
});
it.each(['undo','cancelled','no_show'])('一般の待機中の予約訂正も再開時に止める: %s',async(kind)=>{
 await definition();const run=await start(),e=executors();await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors});
 invalidate(kind);await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});expect(e.push).not.toHaveBeenCalled();
 expect(t.raw.prepare('SELECT status FROM automation_runs WHERE id=?').get(run.runId)).toEqual({status:'cancelled'});
});
it('管理対象は未承認の実行自体を作らず、承認後にだけ開始する',async()=>{
 await definition(true);invalidate('approval');expect((await start()).runId).toBeNull();
 expect(t.raw.prepare('SELECT count(*) n FROM automation_runs').get()).toEqual({n:0});
 t.raw.exec("UPDATE rt_approval_requests SET status='approved'");const run=await start(),e=executors();
 await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors});await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});expect(e.push).toHaveBeenCalledTimes(1);
});
it.each(['approval','template','cancelled','changed'])('送信準備中の更新も、LINEを呼ぶ直前で止める: %s',async(kind)=>{
 await definition(true,true);const run=await start(),e=executors(()=>invalidate(kind));
 await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors});await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});
 expect(e.push).not.toHaveBeenCalled();expect(t.raw.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({n:0});
});
it('再承認しても、古い承認で始めた待機へ別の本文を引き継がない',async()=>{
 await definition(true,true);const run=await start(),e=executors();await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors});invalidate('template');
 const snapshot=await readFollowupEngineSnapshot(t.db,{engine:'automation',targetId:'auto',lineAccountId:'a',storeId:'store'});
 t.raw.prepare('UPDATE rt_store_followup_targets SET approved_content_hash=?').run(snapshot!.contentHash);
 const payload=JSON.parse((t.raw.prepare('SELECT payload_json FROM rt_approval_requests').get() as {payload_json:string}).payload_json);
 payload.targets[0].contentHash=snapshot!.contentHash;t.raw.prepare('UPDATE rt_approval_requests SET payload_json=?').run(JSON.stringify(payload));
 await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});expect(e.push).not.toHaveBeenCalled();
});

it('普通の飲食の予約変更だけでは止めず、同じ予約IDの新しい内容を差し込む',async()=>{
 await definition();const run=await start(),e=executors();await processAutomationRun(t.db,run.runId!,{now:startAt,executors:e.executors});
 invalidate('changed');await processDueAutomationRuns(t.db,{now:resumeAt,executors:e.executors});
 expect(e.push).toHaveBeenCalledTimes(1);expect(JSON.stringify(e.push.mock.calls)).toContain('5名 食堂');
});
it.each(['pending','approved'])('管理対象の一般の1人テストは、承認の前後とも入口で拒否する: %s',async(status)=>{
 await definition(true);t.raw.prepare('UPDATE rt_approval_requests SET status=?').run(status);
 const version=t.raw.prepare("SELECT trigger_type,trigger_config,condition_config,action_config FROM automation_versions WHERE id='v'").get() as {trigger_type:string;trigger_config:string;condition_config:string;action_config:string};
 await expect(runAutomationTest(t.db,{automationId:'auto',versionId:await automationRevisionToken('v',version),friendId:'f',lineAccountId:'a'}))
 .rejects.toMatchObject({code:'version_conflict',message:'来店フォローの試し送りは、専用画面から登録済みのテスト送信先へ行ってください'});
 const result=await startAutomationRun(t.db,{lineAccountId:'a',automationId:'auto',automationVersionId:'v',sourceEventId:'manual',idempotencyKey:'manual-test',friendId:'f',inputEvent:{type:'manual_test'},isTest:true,conditionMatched:true,now:startAt});
 expect(result.runId).toBeNull();expect(t.raw.prepare('SELECT count(*) n FROM automation_runs').get()).toEqual({n:0});
});

it('すでに残っている管理対象のis_test実行も、承認を迂回して顧客へ送らない',async()=>{
 await definition(true);invalidate('approval');
 t.raw.prepare(`INSERT INTO automation_runs(id,line_account_id,automation_id,automation_version_id,friend_id,source_event_id,idempotency_key,status,input_event_json,is_test,execution_plan_json)
 VALUES('old-test','a','auto','v','f','manual','old-test','queued','{}',1,?)`).run(JSON.stringify([{id:'send',type:'send_message',params:{content:'未承認の本文'},onFailure:'stop'}]));
 const e=executors();expect(await processAutomationRun(t.db,'old-test',{now:startAt,executors:e.executors})).toBe('cancelled');expect(e.push).not.toHaveBeenCalled();
});
it.each(['changed','cancelled'])('普通の予約受付直後のルールは、日時変更なら現在の予約で送り、取消なら止まる: %s',async(kind)=>{
 const actions=[{id:'send',type:'send_message',params:{content:'{{reservation_datetime}} {{var.guest_count}}名'},onFailure:'stop'}];
 t.raw.exec("INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES('auto','a','受付','active')");
 t.raw.prepare("INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config) VALUES('v','auto',1,'published','restaurant.reservation.created',?)").run(JSON.stringify(actions));
 t.raw.exec("UPDATE automation_definitions SET current_published_version_id='v' WHERE id='auto'");
 const event=t.raw.prepare("SELECT id FROM rt_reservation_events WHERE reservation_id='r' AND event_type='restaurant.reservation.created'").get() as {id:string};
 invalidate(kind);const result=await startAutomationRun(t.db,{lineAccountId:'a',automationId:'auto',sourceEventId:event.id,idempotencyKey:'created',friendId:'f',inputEvent:{type:'restaurant.reservation.created'},conditionMatched:true,now:startAt});const e=executors();
 if(kind==='cancelled'){expect(result.runId).toBeNull();expect(e.push).not.toHaveBeenCalled();}
 else{expect(await processAutomationRun(t.db,result.runId!,{now:startAt,executors:e.executors})).toBe('success');expect(JSON.stringify(e.push.mock.calls)).toContain('2026-11-02 18:00 5名');}
});
