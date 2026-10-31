import { seedExistingRestaurantFollowup } from '../test-utils/restaurant-followup-fixture.js';
import { saveFollowupDraftFixture } from '../test-utils/restaurant-followup-draft.js';
import { getAutomationDraft } from '../features/automations/automation-drafts/index.js';
import { getReminderDraftVersion,publishScenarioVersion } from '@line-crm/db';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readRestaurantFollowupRows,setRestaurantFollowupRow } from './restaurant-followup-rows.js';
import { saveRestaurantFollowupStoreDrafts,saveRestaurantFollowupEngineDraft,type FollowupDraftInput } from './restaurant-followup-engine-draft.js';
let t:SqliteD1;
beforeEach(()=>{t=createTestD1({foreignKeys:true});t.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店舗','S','a');`);});
afterEach(()=>t.raw.close());
const bubble=(text='ご予約ありがとうございます')=>[{id:'body',type:'text',content:{text}}];
it('未移行の店は1行だけ新しい送り手にしない',async()=>{
 await expect(saveRestaurantFollowupEngineDraft(t.db,'store','reservation_created',await input(),'owner')).rejects.toMatchObject({code:'version_conflict'});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:0});
});
async function input(trigger='reservation_created'):Promise<FollowupDraftInput>{
 const row=(await readRestaurantFollowupRows(t.db,'store')).find(item=>item.trigger===trigger)!;
 return {expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:true,timing:{mode:'countdown',offsetMinutes:0},messageBubbles:bubble()};
}
it('保存で止めた下書きと対応表を一緒に作り、同時要求でも実物を増やさない',async()=>{
 const body=await input();const result=await Promise.allSettled([saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner'),saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner')]);
 expect(result.filter(item=>item.status==='fulfilled')).toHaveLength(1);
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:1});
 expect(t.raw.prepare('SELECT status,current_published_version_id FROM automation_definitions').get()).toEqual({status:'draft',current_published_version_id:null});
 expect(t.raw.prepare('SELECT engine,enabled,sending_status,approval_id FROM rt_store_followup_targets').get()).toEqual({engine:'automation',enabled:1,sending_status:'stopped',approval_id:null});
});
it('リマインダは現地の暦の時刻を既存の保存形式へ置き、テスト成功や公開を偽造しない',async()=>{
 const body={...await input('reservation_24h'),timing:{mode:'time' as const,offsetDays:-1,sendAtTime:'18:00'}};
 await saveFollowupDraftFixture(t.db,'store','reservation_24h',body,'owner');
 expect(t.raw.prepare('SELECT is_active,lifecycle_status FROM reminders').get()).toEqual({is_active:0,lifecycle_status:'draft'});
 expect(t.raw.prepare('SELECT status,last_test_status FROM reminder_versions').get()).toEqual({status:'draft',last_test_status:null});
 expect(t.raw.prepare('SELECT offset_days,send_at_time FROM reminder_version_steps').get()).toEqual({offset_days:-1,send_at_time:'18:00'});
});
it('古い行の版で保存すると実物も結びも残さない',async()=>{
 const body=await input();body.expectedRowVersion++;
 await expect(saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner')).rejects.toMatchObject({code:'version_conflict'});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:0});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
});
it('オフだけなら本体を作らず、既存の結びを停止する',async()=>{
 let body=await input();await setRestaurantFollowupRow(t.db,'store','reservation_created',body.expectedRowVersion,true);
 body=await input();await saveFollowupDraftFixture(t.db,'store','reservation_created',{...body,enabled:false},'owner');
 expect(t.raw.prepare('SELECT enabled FROM rt_store_followup_step_bindings').get()).toEqual({enabled:0});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:0});
});

it('再保存は同じ実物の新しい版になり、オフと再開でも増えない',async()=>{
 await saveFollowupDraftFixture(t.db,'store','reservation_created',await input(),'owner');
 const target=t.raw.prepare('SELECT automation_id FROM rt_store_followup_targets').get() as {automation_id:string};
 const draft=await getAutomationDraft(t.db,{id:target.automation_id,lineAccountId:'a'});
 await saveFollowupDraftFixture(t.db,'store','reservation_created',{...await input(),expectedTargetVersion:1,expectedContentRevision:draft.draftVersionId,messageBubbles:bubble('変えたお礼')},'owner');
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:1});
 expect(t.raw.prepare('SELECT automation_id,version,sending_status FROM rt_store_followup_targets').get()).toEqual({automation_id:target.automation_id,version:2,sending_status:'stopped'});
 const current=await getAutomationDraft(t.db,{id:target.automation_id,lineAccountId:'a'});
 expect(current.actions[0].params.content).toBe('変えたお礼');expect(current.draftVersionId).not.toBe(draft.draftVersionId);
 const stale={...await input(),expectedTargetVersion:2,expectedContentRevision:draft.draftVersionId};
 await expect(saveFollowupDraftFixture(t.db,'store','reservation_created',stale,'owner')).rejects.toMatchObject({code:'version_conflict'});
 await saveFollowupDraftFixture(t.db,'store','reservation_created',{...stale,enabled:false},'owner');
 expect(t.raw.prepare('SELECT enabled,approval_id FROM rt_store_followup_targets').get()).toEqual({enabled:0,approval_id:null});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:1});
});
it('リマインダも実物IDと通知のIDを保ち、編集するとテストの結果を引き継がない',async()=>{
 const body={...await input('reservation_24h'),timing:{mode:'time' as const,offsetDays:-1,sendAtTime:'18:00'},messageBubbles:[...bubble(),...bubble('二つ目')]};
 await saveFollowupDraftFixture(t.db,'store','reservation_24h',body,'owner');
 const target=t.raw.prepare('SELECT reminder_id FROM rt_store_followup_targets').get() as {reminder_id:string};
 const draft=(await getReminderDraftVersion(t.db,target.reminder_id))!;
 t.raw.exec("UPDATE reminder_versions SET last_test_status='succeeded'");
 const step=t.raw.prepare('SELECT stable_step_id FROM reminder_version_steps').get();
 await saveFollowupDraftFixture(t.db,'store','reservation_24h',{...await input('reservation_24h'),timing:body.timing,expectedTargetVersion:1,expectedContentRevision:`${draft.id}:${draft.updated_at}`,messageBubbles:bubble('変更')},'owner');
 expect(t.raw.prepare('SELECT count(*) n FROM reminders').get()).toEqual({n:1});
 expect(t.raw.prepare('SELECT stable_step_id FROM reminder_version_steps').get()).toEqual(step);
 expect(t.raw.prepare('SELECT last_test_status FROM reminder_versions').get()).toEqual({last_test_status:null});
});

it('初回7行のうち最後の版が変わっても、実物と送り手を半分だけ作らない',async()=>{
 const rows=await readRestaurantFollowupRows(t.db,'store');
 const body=rows.map(row=>({trigger:row.trigger,input:{expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:['reservation_created','post_visit'].includes(row.trigger),timing:{mode:'countdown' as const,offsetMinutes:0},messageBubbles:bubble()}}));
 body[6].input.expectedRowVersion++;
 await expect(saveRestaurantFollowupStoreDrafts(t.db,'store',body,'owner')).rejects.toMatchObject({code:'version_conflict'});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:0});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
 body[6].input.expectedRowVersion--;
 await saveRestaurantFollowupStoreDrafts(t.db,'store',body,'owner');
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:2});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:2});
 expect(t.raw.prepare("SELECT count(*) n FROM rt_store_followup_step_bindings WHERE enabled=1").get()).toEqual({n:0});
});

it('7行の書込の直前に最後の行が更新されたら、先の行の実物もまとめて戻す',async()=>{
 const rows=await readRestaurantFollowupRows(t.db,'store');
 const body=rows.map(row=>({trigger:row.trigger,input:{expectedRowVersion:row.version,expectedTargetVersion:0,expectedContentRevision:null,enabled:['reservation_created','post_visit'].includes(row.trigger),timing:{mode:'countdown' as const,offsetMinutes:0},messageBubbles:bubble()}}));
 const batch=t.db.batch.bind(t.db);
 vi.spyOn(t.db,'batch').mockImplementationOnce(async statements=>{
  t.raw.prepare('UPDATE rt_store_followup_rows SET version=version+1 WHERE store_id=? AND trigger=?').run('store',rows[6].trigger);
  return batch(statements);
 });
 await expect(saveRestaurantFollowupStoreDrafts(t.db,'store',body,'owner')).rejects.toMatchObject({code:'version_conflict'});
 expect(t.raw.prepare('SELECT count(*) n FROM automation_definitions').get()).toEqual({n:0});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
});

for(const code of [null,'LINE_DELIVERY_UNKNOWN','LINE_REQUEST_REJECTED','LINE_RATE_LIMITED'] as const)it(`旧送信の結果${code??'未記録'}は、未受理が確定した失敗だけを切り替える`,async()=>{
 seedExistingRestaurantFollowup(t,'store');
 const body=await input();
 const version=await publishScenarioVersion(t.db,'restaurant-followup:store',{staffId:null,idempotencyKey:crypto.randomUUID()});
 const published=t.raw.prepare('SELECT id,steps_snapshot FROM scenario_versions WHERE id=?').get(version.id) as {id:string;steps_snapshot:string};
 const step=JSON.parse(published.steps_snapshot).find((item:{live_step_id:string})=>item.live_step_id.endsWith(':reservation_created'));
 t.raw.exec("INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち')");
 t.raw.prepare(`INSERT INTO scenario_source_jobs(id,line_account_id,friend_id,scenario_version_id,step_id,source_kind,source_id,source_event_id,source_version,scheduled_at,status,attempt_count,idempotency_key)
  VALUES('old','a','f',?,?,'restaurant_reservation','r','e',1,'2030-01-01','failed',1,'old-key')`).run(published.id,step.version_step_id);
 if(code)t.raw.prepare(`INSERT INTO outbound_send_requests(idempotency_key,channel,resource_id,payload_hash,line_account_id,status,failure_code,last_failed_at,created_at,updated_at) VALUES('old-key','line','old','x','a',?,?,?,?,?)`)
  .run(code==='LINE_DELIVERY_UNKNOWN'?'unknown':'failed',code,'2030-01-01','2030-01-01','2030-01-01');
 if(code==='LINE_REQUEST_REJECTED'||code==='LINE_RATE_LIMITED'){
  await saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner');
  expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:1});
 }else{
  await expect(saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner')).rejects.toMatchObject({code:'delivery_unconfirmed'});
  expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
 }
});

it('以前の未受理の記録があっても、今実行中の旧送信があれば切り替えない',async()=>{
 seedExistingRestaurantFollowup(t,'store');const body=await input();
 const version=await publishScenarioVersion(t.db,'restaurant-followup:store',{staffId:null,idempotencyKey:crypto.randomUUID()});
 const step=JSON.parse(version.steps_snapshot).find((item:{live_step_id:string})=>item.live_step_id.endsWith(':reservation_created'));
 t.raw.exec("INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち')");
 t.raw.prepare(`INSERT INTO scenario_source_jobs(id,line_account_id,friend_id,scenario_version_id,step_id,source_kind,source_id,source_event_id,source_version,scheduled_at,status,attempt_count,idempotency_key)
  VALUES('old','a','f',?,?,'restaurant_reservation','r','e',1,'2030-01-01','running',2,'old-key')`).run(version.id,step.version_step_id);
 t.raw.exec(`INSERT INTO outbound_send_requests(idempotency_key,channel,resource_id,payload_hash,line_account_id,status,failure_code,last_failed_at,created_at,updated_at) VALUES('old-key','line','old','x','a','failed','LINE_REQUEST_REJECTED','2030-01-01','2030-01-01','2030-01-01')`);
 await expect(saveFollowupDraftFixture(t.db,'store','reservation_created',body,'owner')).rejects.toMatchObject({code:'delivery_unconfirmed'});
 expect(t.raw.prepare('SELECT count(*) n FROM rt_store_followup_targets').get()).toEqual({n:0});
});

it('詳細で足したテンプレートや条件を簡易保存で消さず、停止操作だけは受ける',async()=>{
 const body={...await input('reservation_24h'),timing:{mode:'time' as const,offsetDays:-1,sendAtTime:'18:00'}};
 await saveFollowupDraftFixture(t.db,'store','reservation_24h',body,'owner');
 const {reminder_id:id}=t.raw.prepare('SELECT reminder_id FROM rt_store_followup_targets').get() as {reminder_id:string};
 const original=(await getReminderDraftVersion(t.db,id))!;
 const settings=JSON.parse(original.settings_snapshot);settings.steps[0].templateId='external-template';
 t.raw.prepare('UPDATE reminder_versions SET settings_snapshot=? WHERE id=?').run(JSON.stringify(settings),original.id);
 const changed=(await getReminderDraftVersion(t.db,id))!;
 const current={...await input('reservation_24h'),timing:body.timing,expectedTargetVersion:1,expectedContentRevision:`${changed.id}:${changed.updated_at}`};
 await expect(saveRestaurantFollowupEngineDraft(t.db,'store','reservation_24h',current,'owner')).rejects.toMatchObject({code:'invalid_followup'});
 expect((await getReminderDraftVersion(t.db,id))!.settings_snapshot).toBe(changed.settings_snapshot);
 await saveRestaurantFollowupEngineDraft(t.db,'store','reservation_24h',{...current,enabled:false},'owner');
 expect((await getReminderDraftVersion(t.db,id))!.settings_snapshot).toBe(changed.settings_snapshot);
});
