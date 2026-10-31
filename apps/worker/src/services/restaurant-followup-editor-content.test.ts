import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { seedExistingRestaurantFollowup } from '../test-utils/restaurant-followup-fixture.js';
import { readRestaurantFollowupRows } from './restaurant-followup-rows.js';
import { expect,it } from 'vitest';
import { automationFollowupEditorContent,reminderFollowupEditorContent,readLegacyFollowupEditorContents } from './restaurant-followup-editor-content.js';
import type { ReminderVersionRow } from '@line-crm/db';
const message={id:'m',type:'send_message',params:{messageType:'text',content:'予約ありがとうございます'},onFailure:'stop'};
const version=(actions:unknown[])=>({trigger_type:'restaurant.departed',trigger_config:JSON.stringify({storeId:'store'}),condition_config:'{}',action_config:JSON.stringify(actions)});
it('翌日の待機と全ての吹き出しを実物から復元する',()=>{
 expect(automationFollowupEditorContent(version([{id:'w',type:'wait',params:{mode:'next_day',sendAtTime:'10:00'},onFailure:'stop'},message,{...message,id:'m2',params:{messageType:'text',content:'お待ちしています'}}]),'store','post_visit')).toEqual({timing:{mode:'next_day',sendAtTime:'10:00'},messageParts:[{messageType:'text',messageContent:'予約ありがとうございます'},{messageType:'text',messageContent:'お待ちしています'}]});
});
it('追加の処理・条件・別の店は空の本文へ置き換えず詳細編集に残す',()=>{
 for(const changed of [version([message,{id:'tag',type:'add_tag',params:{tagId:'t'},onFailure:'stop'}]),{...version([message]),condition_config:'{"tagId":"t"}'},{...version([message]),trigger_config:'{"storeId":"another"}'}])expect(automationFollowupEditorContent(changed,'store','post_visit')).toBeNull();
});
it('リマインダは1つの時刻と全ての吹き出しを復元し、複数の時刻は潰さない',()=>{
 const step={offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'先頭',messageParts:[{messageType:'text',messageContent:'先頭'},{messageType:'text',messageContent:'続き'}]};
 const settings={triggerType:'manual',repeatYearly:false,leapYearPolicy:'feb28',stopConditions:{bookingCancelled:true,friendBlocked:true,supportMarkCompleted:false,daysAfterTarget:0}};
 const row={settings_snapshot:JSON.stringify({...settings,deliveryMode:'time',steps:[step]})} as ReminderVersionRow;
 expect(reminderFollowupEditorContent(row,'reservation_24h')).toEqual({timing:{mode:'time',offsetDays:-1,sendAtTime:'18:00'},messageParts:step.messageParts});
 expect(reminderFollowupEditorContent({...row,settings_snapshot:JSON.stringify({...settings,deliveryMode:'time',steps:[step,step]})},'reservation_24h')).toBeNull();
 expect(reminderFollowupEditorContent({...row,settings_snapshot:'{broken'},'reservation_24h')).toBeNull();
});

it('細かい条件やテンプレートとの結びを持つ本文を簡易編集へ戻さない',()=>{
 const settings={triggerType:'manual',deliveryMode:'time',repeatYearly:false,leapYearPolicy:'feb28',stopConditions:{bookingCancelled:true,friendBlocked:true,supportMarkCompleted:false,daysAfterTarget:0},steps:[{stableStepId:'s',offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'本文'}]};
 const changed=[{...settings,steps:[{...settings.steps[0],templateId:'template'}]},{...settings,steps:[{...settings.steps[0],targetCondition:{tagId:'tag'}}]},{...settings,steps:[{...settings.steps[0],action:{type:'add_tag'}}]},{...settings,triggerType:'booking'},{...settings,repeatYearly:true},{...settings,leapYearPolicy:'skip'},{...settings,stopConditions:{...settings.stopConditions,daysAfterTarget:7}},{...settings,targetTagId:'tag'}];
 for(const value of changed){const serialized=JSON.stringify(value);expect(reminderFollowupEditorContent({settings_snapshot:serialized} as ReminderVersionRow,'reservation_24h')).toBeNull();expect(JSON.stringify(value)).toBe(serialized);}
 expect(automationFollowupEditorContent(version([{...message,params:{...message.params,quickReply:{items:[]}}}]),'store','post_visit')).toBeNull();
});

it('旧の複数の結びは1行の詳細案内にし、端数の日数を簡易保存で丸めない',async()=>{
 const t=createTestD1({foreignKeys:true});
 try{
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
   INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
   INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店舗','S','a');`);
  seedExistingRestaurantFollowup(t,'store');await readRestaurantFollowupRows(t.db,'store');
  t.raw.exec("UPDATE rt_store_followup_rows SET step_id=NULL WHERE trigger='reservation_created'; INSERT INTO scenario_steps(id,scenario_id,step_order,message_type,message_content,is_draft) VALUES('duplicate','restaurant-followup:store',9,'text','別の本文',0); INSERT INTO rt_store_followup_step_bindings(store_id,trigger,step_id,offset_minutes,enabled) VALUES('store','reservation_created','duplicate',0,1); UPDATE rt_store_followup_rows SET step_id=NULL WHERE trigger='reservation_created'; UPDATE rt_store_followup_step_bindings SET offset_minutes=-1441 WHERE trigger='anniversary_before'");
  const result=await readLegacyFollowupEditorContents(t.db,'store');
  expect(result.filter(row=>row.trigger==='reservation_created')).toEqual([{trigger:'reservation_created',content:null}]);
  expect(result.find(row=>row.trigger==='anniversary_before')?.content).toBeNull();
  expect(result).toHaveLength(7);
  const {step_id}=t.raw.prepare("SELECT step_id FROM rt_store_followup_step_bindings WHERE trigger='reservation_created' AND step_id!='duplicate'").get() as {step_id:string};
  t.raw.prepare("UPDATE rt_store_followup_rows SET step_id=? WHERE trigger='reservation_created'").run(step_id);
  expect((await readLegacyFollowupEditorContents(t.db,'store')).find(row=>row.trigger==='reservation_created')?.content?.messageParts[0].messageContent).toBe('予約が入りました。');
 }finally{t.raw.close();}
});

it('詳細で変えたきっかけや壊れた吹き出しを簡易編集の設定で上書きしない',()=>{
 expect(automationFollowupEditorContent({...version([message]),trigger_type:'restaurant.reservation.created'},'store','post_visit')).toBeNull();
 const settings={triggerType:'manual',deliveryMode:'time',repeatYearly:false,leapYearPolicy:'feb28',stopConditions:{bookingCancelled:true,friendBlocked:true,supportMarkCompleted:false,daysAfterTarget:0},steps:[{offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'本文',messageParts:'broken'}]};
 expect(reminderFollowupEditorContent({settings_snapshot:JSON.stringify(settings)} as ReminderVersionRow,'reservation_24h')).toBeNull();
});
