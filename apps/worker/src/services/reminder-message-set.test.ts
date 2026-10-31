import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import type { LineClient } from '@line-crm/line-sdk';
import { createReminderWithDraftVersion,recordReminderDraftTest,publishReminderDraftVersion,enrollFriendInReminder,getReminderVersionSteps,getFriendById,type ReminderDraftSettings } from '@line-crm/db';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { buildReminderStepMessage,processReminderDeliveries } from './reminder-delivery.js';
import { restoreReminderMessage } from './reminder-message-set.js';
import { readDraftSettings } from '../routes/reminders-definition-read-draft-settings.js';
let t:SqliteD1;
const parts=[{messageType:'text',messageContent:'{{name}}さんへ'},{messageType:'text',messageContent:'2つ目の文です'}];
const settings=():ReminderDraftSettings=>({name:'来店前',lineAccountId:'a',triggerType:'manual',deliveryMode:'countdown',stopConditions:{bookingCancelled:true,friendBlocked:true,supportMarkCompleted:false,daysAfterTarget:null},steps:[{stableStepId:'step',offsetMinutes:0,messageType:parts[0].messageType,messageContent:parts[0].messageContent,messageParts:parts}]});
beforeEach(()=>{t=createTestD1({foreignKeys:true});t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
 INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','さくら');`);});
afterEach(()=>t.raw.close());
it('同時刻の吹き出しは1つのステップ・1つの要求で送り、すべての履歴を残す',async()=>{
 const draft=await createReminderWithDraftVersion(t.db,settings());await recordReminderDraftTest(t.db,draft.version.id,{succeeded:true,staffId:null});
 await publishReminderDraftVersion(t.db,draft.reminder.id,null);
 const enrolled=await enrollFriendInReminder(t.db,{friendId:'f',reminderId:draft.reminder.id,targetDate:'2026-10-31T00:00:00Z'});expect(enrolled).toBeTruthy();
 const push=vi.fn(async(_user:string,_messages:unknown[],_key?:string)=>({requestId:'request'})),client={pushMessageWithRequestId:push} as unknown as LineClient;
 const options={now:new Date('2026-10-31T00:00:00Z'),pause:async()=>{},resolveClient:async()=>client};
 await processReminderDeliveries(t.db,client,options);await processReminderDeliveries(t.db,client,options);
 expect(push).toHaveBeenCalledTimes(1);
 expect(push.mock.calls[0]?.[1]).toEqual([{type:'text',text:'さくらさんへ'},{type:'text',text:'2つ目の文です'}]);
 expect(t.raw.prepare("SELECT count(*) n FROM messages_log WHERE source='reminder'").get()).toEqual({n:2});
 const saved=t.raw.prepare('SELECT sent_message_type,sent_message_content FROM reminder_delivery_runs').get() as {sent_message_type:string;sent_message_content:string};
 const restored=restoreReminderMessage({messageType:saved.sent_message_type,messageContent:saved.sent_message_content,templateId:null});
 expect(restored.messages).toEqual(push.mock.calls[0]?.[1]);
});
it('下書きの読取とテストの組立てでも残りの吹き出しを落とさない',async()=>{
 const draft=await createReminderWithDraftVersion(t.db,settings());const rows=await getReminderVersionSteps(t.db,draft.version.id),friend=(await getFriendById(t.db,'f'))!;
 const built=await buildReminderStepMessage(t.db,rows[0],friend,new Date(),'test_send');
 expect(built.messages).toHaveLength(2);
 const parsed=readDraftSettings({...settings(),steps:[{...settings().steps[0],messageContent:'変更した先頭'}]});
 expect(parsed.ok&&parsed.value.steps[0].messageParts).toEqual([{messageType:'text',messageContent:'変更した先頭'},parts[1]]);
});
it('壊れた固定本文を1つ目のテキストとして送らない',()=>{
 expect(()=>restoreReminderMessage({messageType:'message_set',messageContent:'{}',templateId:null})).toThrow();
});
for(const invalidSettings of ['{broken','{"steps":{}}'])it(`壊れた設定${invalidSettings}が1つあっても、ほかのリマインダの全吹き出しは送られる`,async()=>{
 const valid=await createReminderWithDraftVersion(t.db,settings()),broken=await createReminderWithDraftVersion(t.db,{...settings(),name:'壊れた版',steps:[{...settings().steps[0],stableStepId:'broken-step'}]});
 for(const draft of [valid,broken]){
  await recordReminderDraftTest(t.db,draft.version.id,{succeeded:true,staffId:null});await publishReminderDraftVersion(t.db,draft.reminder.id,null);
  await enrollFriendInReminder(t.db,{friendId:'f',reminderId:draft.reminder.id,targetDate:'2026-10-31T00:00:00Z'});
 }
 // 過去の破損を専用の空DBに再現する。製品の制約は変更せず、注入後すぐ元へ戻す。
 const immutable=t.raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_reminder_versions_immutable_update'").get() as {sql:string};
 t.raw.pragma('ignore_check_constraints = ON');
 try{t.raw.transaction(()=>{
  t.raw.exec('DROP TRIGGER trg_reminder_versions_immutable_update');
  t.raw.prepare('UPDATE reminder_versions SET settings_snapshot=? WHERE id=?').run(invalidSettings,broken.version.id);
  t.raw.exec(immutable.sql);
 })();}finally{t.raw.pragma('ignore_check_constraints = OFF');}
 expect(()=>t.raw.prepare('UPDATE reminder_versions SET settings_snapshot=? WHERE id=?').run('{}',broken.version.id)).toThrow('published reminder versions are immutable');
 const push=vi.fn(async(_user:string,_messages:unknown[],_key?:string)=>({requestId:'request'})),client={pushMessageWithRequestId:push} as unknown as LineClient;
 await expect(processReminderDeliveries(t.db,client,{now:new Date('2026-10-31T00:00:00Z'),pause:async()=>{},resolveClient:async()=>client})).resolves.toMatchObject({succeeded:1});
 expect(push).toHaveBeenCalledTimes(1);expect(push.mock.calls[0]?.[1]).toHaveLength(2);
});
