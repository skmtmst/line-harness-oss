import { restaurantFollowupInitialValues } from './restaurant-followup-rows.js';
import { parseReminderVersionSettings,type ReminderVersionRow } from '@line-crm/db';
import { parseAutomationWait,type RestaurantFollowupEditorContent,type RestaurantFollowupTrigger } from '@line-crm/shared';
import { parseActions } from '../features/automations/automation-plan/index.js';
import { parseBroadcastMessageParts } from '../features/broadcasts/broadcast-message-set/index.js';

/** かんたんな1回の送信に戻せない構成は、消さずに詳細画面へ案内する。 */
export function reminderFollowupEditorContent(version:ReminderVersionRow,trigger:RestaurantFollowupTrigger,anniversaryFieldId?:string):RestaurantFollowupEditorContent|null{
 try{
  const settings=parseReminderVersionSettings(version);
  const anniversary=trigger==='anniversary_before';
  if(settings.triggerType!==(anniversary?'friend_field':'manual')||!!settings.repeatYearly!==anniversary||settings.leapYearPolicy!=='feb28'
   ||(settings.triggerFieldId??null)!==(anniversary?anniversaryFieldId??null:null)||anniversary&&!anniversaryFieldId
   ||settings.triggerEventId!=null||settings.triggerOffsetMinutes!=null||settings.sendAtTime!=null||settings.targetTagId!=null||settings.targetCondition!=null
   ||settings.description!=null||settings.folderId!=null
   ||settings.stopConditions?.bookingCancelled!==true||settings.stopConditions?.friendBlocked!==true
   ||settings.stopConditions?.supportMarkCompleted!==false||settings.stopConditions?.daysAfterTarget!==0
   ||settings.steps.length!==1)return null;
  const step=settings.steps[0];
  if(!step||step.templateId!=null||step.targetCondition&&Object.keys(step.targetCondition).length||step.action&&Object.keys(step.action).length)return null;
  const timing=settings.deliveryMode==='time'&&typeof step.offsetDays==='number'&&typeof step.sendAtTime==='string'
   ?{mode:'time' as const,offsetDays:step.offsetDays,sendAtTime:step.sendAtTime}
   :settings.deliveryMode==='countdown'?{mode:'countdown' as const,offsetMinutes:step.offsetMinutes}:null;
  if(!timing||timing.mode==='time'&&(!Number.isSafeInteger(timing.offsetDays)||timing.offsetDays>0||timing.offsetDays< -365||!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.sendAtTime))||timing.mode==='countdown'&&(!Number.isSafeInteger(timing.offsetMinutes)||timing.offsetMinutes>=0||timing.offsetMinutes< -525600))return null;
  if(anniversary&&(timing.mode!=='time'||timing.offsetDays>=0))return null;
  const parts=step.messageParts??[{messageType:step.messageType,messageContent:step.messageContent}];
  if(!Array.isArray(parts)||!parts.length||parts.length>5||parts.some(part=>!part||typeof part.messageType!=='string'||typeof part.messageContent!=='string'))return null;
  return {timing,messageParts:parts};
 }catch{return null;}
}
export function automationFollowupEditorContent(version:{action_config:string;condition_config:string;trigger_config:string;trigger_type:string},storeId:string,sourceTrigger:RestaurantFollowupTrigger):RestaurantFollowupEditorContent|null{
 try{
  const expectedEvent=sourceTrigger==='reservation_created'?'restaurant.reservation.created':sourceTrigger==='waitlist_invited'?'restaurant.waitlist.invited':'restaurant.departed';
  if(version.trigger_type!==expectedEvent)return null;
  const trigger=JSON.parse(version.trigger_config),conditions=JSON.parse(version.condition_config);
  if(trigger.storeId!==storeId||Object.keys(trigger).some(key=>key!=='storeId')||Object.keys(conditions).length)return null;
  const actions=parseActions(version.action_config);
  let timing:RestaurantFollowupEditorContent['timing']={mode:'countdown',offsetMinutes:0};
  if(actions[0]?.type==='wait'){
   const result=parseAutomationWait(actions[0].params,Infinity);
   if(!result||actions[0].onFailure!=='stop'||actions[0].branchConditions?.length||Object.keys(actions[0].params).some(key=>!('mode' in result?['mode','sendAtTime']:['durationMinutes','minutes']).includes(key)))return null;
   timing='mode' in result?{mode:'next_day',sendAtTime:result.sendAtTime}:{mode:'countdown',offsetMinutes:result.durationMinutes};
   actions.shift();
  }
  if(!actions.length||actions.some(action=>action.type!=='send_message'||action.onFailure!=='stop'||action.branchConditions?.length||typeof action.params.content!=='string'||typeof action.params.messageType!=='string'||Object.keys(action.params).some(key=>key!=='messageType'&&key!=='content')))return null;
  return {timing,messageParts:actions.map(action=>({messageType:String(action.params.messageType),messageContent:String(action.params.content)}))};
 }catch{return null;}
}
export async function readLegacyFollowupEditorContents(db:D1Database,storeId:string){
 const rows=(await db.prepare(`SELECT r.trigger,b.offset_minutes,b.anniversary_time,st.message_type,st.message_content,st.message_bubbles_json
 FROM rt_store_followup_rows r LEFT JOIN rt_store_followup_templates t ON t.store_id=r.store_id
 LEFT JOIN rt_store_followup_step_bindings b ON b.store_id=r.store_id AND b.trigger=r.trigger AND (r.step_id IS NULL OR r.step_id=b.step_id)
 LEFT JOIN scenario_steps st ON st.id=b.step_id AND st.scenario_id=t.scenario_id
 WHERE r.store_id=?`).bind(storeId).all<{trigger:RestaurantFollowupTrigger;offset_minutes:number|null;anniversary_time:string|null;message_type:string|null;message_content:string|null;message_bubbles_json:string|null}>()).results;
 const grouped=new Map<RestaurantFollowupTrigger,typeof rows>();
 for(const row of rows)grouped.set(row.trigger,[...(grouped.get(row.trigger)??[]),row]);
 return [...grouped].map(([trigger,matches])=>{
  if(matches.length!==1)return {trigger,content:null};
  const row=matches[0];
  try{
   const initial=restaurantFollowupInitialValues(row.trigger);
   const offset=row.offset_minutes??initial.offset;
   if(row.trigger==='anniversary_before'&&offset%1440!==0)return {trigger:row.trigger,content:null};
   const timing:RestaurantFollowupEditorContent['timing']=row.trigger==='anniversary_before'?{mode:'time',offsetDays:offset/1440,sendAtTime:row.anniversary_time??'10:00'}:{mode:'countdown',offsetMinutes:offset};
   const parts=parseBroadcastMessageParts({messageType:row.message_type??'text',messageContent:row.message_content??initial.message,messageBubblesJson:row.message_bubbles_json});
   return {trigger:row.trigger,content:{timing,messageParts:parts.map(part=>({messageType:part.messageType,messageContent:part.messageContent}))}};
  }catch{return {trigger:row.trigger,content:null};}
 });
}
