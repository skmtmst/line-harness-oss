import { expireNextDayWait } from '../features/automations/automation-wait/index.js';
import type { V6WriteGuard } from '@line-crm/db';
import { readFollowupEngineGate, type FollowupApprovalScope, type FollowupEngineGate } from './restaurant-followup-engine-approval.js';
import { readRestaurantAutomationSource, type RestaurantAutomationSource } from './restaurant-automation-source.js';

export type RestaurantAutomationDeliveryGate = { allowed: false; reason: string } | {
  allowed: true; approval: Extract<FollowupEngineGate,{allowed:true}>; source: Extract<RestaurantAutomationSource,{allowed:true}>; guard: V6WriteGuard;
};

interface AutomationGateRun {
 line_account_id:string;automation_id:string;automation_version_id:string;friend_id:string|null;
 source_event_id:string;input_event_json:string;execution_plan_json:string|null;is_test:number;trigger_type:string;
}
export interface RestaurantAutomationDeliveryScope {approval:FollowupApprovalScope;run?:AutomationGateRun}

/** 実行の保存済み入力を読む。呼び出し側のイベントや承認札では本送信を許可しない。 */
export async function readRestaurantAutomationDeliveryGate(db: D1Database, runId: string, now: string, fallback?: {
  automationId:string; automationVersionId:string; lineAccountId:string; friendId:string|null;
  sourceEventId:string; inputEvent:Record<string,unknown>; isTest:boolean; restaurantDeliveryScope?:RestaurantAutomationDeliveryScope;
} , suppliedScope?:RestaurantAutomationDeliveryScope): Promise<RestaurantAutomationDeliveryGate> {
  const scope=suppliedScope??fallback?.restaurantDeliveryScope;
  const run=scope?.run??await db.prepare(`SELECT r.line_account_id,r.automation_id,r.automation_version_id,r.friend_id,r.source_event_id,
    r.input_event_json,r.execution_plan_json,r.is_test,v.trigger_type FROM automation_runs r
    JOIN automation_versions v ON v.id=r.automation_version_id AND v.automation_id=r.automation_id WHERE r.id=?`)
    .bind(runId).first<AutomationGateRun>();
  if(run&&scope)scope.run=run;
  if(!run){
    if(!fallback)return {allowed:false,reason:'automation_run_not_found'};
    const approval=await readFollowupEngineGate(db,{engine:'automation',targetId:fallback.automationId,lineAccountId:fallback.lineAccountId,versionId:fallback.automationVersionId},scope?.approval);
    if(approval.managed)return {allowed:false,reason:'restaurant_followup_not_approved'};
    const source=await readRestaurantAutomationSource(db,{eventType:String(fallback.inputEvent.type??''),eventId:fallback.sourceEventId,
      lineAccountId:fallback.lineAccountId,friendId:fallback.friendId,now,strict:false});
    if(!source.allowed)return {allowed:false,reason:'restaurant_source_changed'};
    return {allowed:true,approval,source,guard:source.restaurant?source.guard:{sql:'1',binds:[]}};
  }
  let hasNextDay=false;
  try{hasNextDay=(JSON.parse(run.execution_plan_json??'[]') as Array<{type:string;params?:{mode?:string}}>).some(action=>action.type==='wait'&&action.params?.mode==='next_day');}
  catch{return {allowed:false,reason:'invalid_action_config'};}
  if(hasNextDay&&await expireNextDayWait(db,runId,now))return {allowed:false,reason:'wait_expired'};
  const approval=await readFollowupEngineGate(db,{engine:'automation',targetId:run.automation_id,lineAccountId:run.line_account_id,
    versionId:run.automation_version_id,executionPlanJson:run.execution_plan_json},scope?.approval);
  if(run.is_test===1)return approval.managed?{allowed:false,reason:'restaurant_followup_test_not_allowed'}
    :{allowed:true,approval,source:{restaurant:false,allowed:true},guard:{sql:'1',binds:[]}};
  if(!approval.allowed)return {allowed:false,reason:'restaurant_followup_not_approved'};
  if(approval.managed){
    let value:unknown;
    try{value=JSON.parse(run.input_event_json).__restaurantFollowup?.contentHash;}catch{return {allowed:false,reason:'restaurant_followup_not_approved'};}
    if(value!==approval.snapshot.contentHash)return {allowed:false,reason:'restaurant_followup_approval_changed'};
  }
  const source=await readRestaurantAutomationSource(db,{eventType:run.trigger_type,eventId:run.source_event_id,
    lineAccountId:run.line_account_id,friendId:run.friend_id,now,strict:approval.managed});
  if(!source.allowed)return {allowed:false,reason:'restaurant_source_changed'};
  if(approval.managed&&(!source.restaurant||source.context.store_id!==approval.storeId))return {allowed:false,reason:'restaurant_source_changed'};
  const guards=[...(approval.managed?[approval.guard]:[]),...(source.restaurant?[source.guard]:[])];
  return {allowed:true,approval,source,guard:{sql:guards.map(item=>`(${item.sql})`).join(' AND ')||'1',binds:guards.flatMap(item=>item.binds)}};
}
