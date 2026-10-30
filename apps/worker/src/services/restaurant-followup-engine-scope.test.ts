import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type {LineClient} from '@line-crm/line-sdk';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readFollowupEngineGate } from './restaurant-followup-engine-approval.js';
import { processReminderDeliveries } from './reminder-delivery.js';
import { processAutomationRun,startAutomationRun } from '../features/automations/automation-engine.js';
import { createAutomationActionExecutors } from '../features/automations/automation-action-executors.js';
let t:SqliteD1;let db:D1Database;let queries:string[];
const now='2026-11-01T09:00:00.000Z';
beforeEach(()=>{t=createTestD1();t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店舗','t','s');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');`);
 queries=[];db=new Proxy(t.db,{get(obj,key){if(key==='prepare')return (sql:string)=>{queries.push(sql);return obj.prepare(sql);};const value=Reflect.get(obj,key);return typeof value==='function'?value.bind(obj):value;}});});
afterEach(()=>t.raw.close());
function check(){expect(queries.filter(sql=>sql.includes('FROM rt_store_followup_targets'))).toHaveLength(1);
 expect(queries.filter(sql=>sql.includes('sqlite_master')||sql.includes('rt_approval_requests'))).toEqual([]);}
it('普通のリマインダ1通には管理対象の索引検索1本だけを足し、承認履歴を走査しない',async()=>{
 t.raw.exec(`INSERT INTO reminders(id,name,line_account_id,is_active,trigger_type,delivery_mode) VALUES('r','普通','a',1,'manual','countdown');
 INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content) VALUES('step','r',-60,'text','お知らせ');
 INSERT INTO friend_reminders(id,friend_id,reminder_id,target_date,status,created_at,updated_at)
 VALUES('enrollment','f','r','2026-11-01T10:00:00Z','active','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');`);
 await readFollowupEngineGate(db,{engine:'reminder',targetId:'warm',lineAccountId:'a',versionId:''});queries.length=0;
 const push=vi.fn(async()=>({data:{},requestId:'ok'})),client={pushMessageWithRequestId:push} as unknown as LineClient;
 expect((await processReminderDeliveries(db,client,{now:new Date(now),pause:async()=>{},resolveClient:async()=>client})).succeeded).toBe(1);
 expect(push).toHaveBeenCalledTimes(1);check();
});
it('普通の自動化は複数の送信と手順の境目でも管理の索引検索1本だけにする',async()=>{
 t.raw.exec("INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES('auto','a','普通','active')");
 const actions=['one','two'].map(id=>({id,type:'send_message',params:{content:id},onFailure:'stop'}));
 t.raw.prepare("INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config) VALUES('v','auto',1,'published','friend_add',?)").run(JSON.stringify(actions));
 t.raw.exec("UPDATE automation_definitions SET current_published_version_id='v' WHERE id='auto'");
 const run=await startAutomationRun(db,{lineAccountId:'a',automationId:'auto',friendId:'f',sourceEventId:'ordinary',idempotencyKey:'ordinary',inputEvent:{type:'friend_add'},conditionMatched:true,now});queries.length=0;
 const push=vi.fn(async()=>({}));const executors=createAutomationActionExecutors({now:()=>now,resolveLineAccessToken:async()=> 'token',createLineClient:()=>({pushMessage:push,linkRichMenuToUser:vi.fn(),unlinkRichMenuFromUser:vi.fn()})});
 expect(await processAutomationRun(db,run.runId!,{now,executors})).toBe('success');expect(push).toHaveBeenCalledTimes(2);check();
});
