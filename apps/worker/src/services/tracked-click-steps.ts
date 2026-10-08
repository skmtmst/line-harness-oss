import {featureJobCanRun} from './feature-enforcement.js';
import { ensureWorkflowStep,prepareWorkflowStep,getWorkflowStep,recordLinkClick,jstNow,enrollFriendInScenario,trackConversion } from '@line-crm/db';
import type { Env } from '../index.js';
import { acquireWorkflow } from './workflow-execution.js';
import { awardActivityMileage } from './activity-mileage.js';
import { applyActionScoreEvent } from './action-score-events.js';
import { dispatchAutomationEventWithLogging } from './automation-triggers.js';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';

export interface TrackedClickPlan {
  linkId:string;friendId:string|null;accountId:string|null;tagId:string|null;scenarioId:string|null;
  clickedAt:string;linkName:string;conversionPointIds:string[];
}
export async function recordTrackedClick(db:D1Database,plan:Omit<TrackedClickPlan,'clickedAt'>){
  const id=crypto.randomUUID(),now=jstNow(),saved={...plan,clickedAt:now};
  const ref={scopeId:`line:${plan.accountId ?? 'default'}`,processKind:'tracked_click',subjectId:id,stepKey:'__run'};
  await recordLinkClick(db,plan.linkId,plan.friendId,{id,now,statements:[prepareWorkflowStep(db,ref,{input:saved,maxAttempts:5})]});
  return {id,plan:saved};
}
export async function queueTrackedClick(db:D1Database,clickId:string,plan:TrackedClickPlan):Promise<void>{
  await ensureWorkflowStep(db,{scopeId:`line:${plan.accountId ?? 'default'}`,processKind:'tracked_click',subjectId:clickId,stepKey:'__run'},
    {input:plan,maxAttempts:5});
}
export async function processTrackedClick(env:Env['Bindings'],clickId:string,plan:TrackedClickPlan):Promise<void>{
  const execution=await acquireWorkflow(env.DB,{scopeId:`line:${plan.accountId ?? 'default'}`,processKind:'tracked_click',subjectId:clickId},
    {input:plan,maxAttempts:5});
  if(!execution)return;
  plan=JSON.parse((await getWorkflowStep(env.DB,execution.ref))!.input_json!);
  try {
    if(plan.accountId && !await featureJobCanRun(env.DB,{accountId:plan.accountId,featureId:'inflow_tracking',job:'durable tracked click continuation'})){await execution.release();return}
    if(plan.friendId && plan.accountId){
      const current=await env.DB.prepare('SELECT line_account_id FROM friends WHERE id=?').bind(plan.friendId).first<{line_account_id:string|null}>();
      if(current?.line_account_id!==plan.accountId)throw new Error('tracked_click_account_changed');
    }
    const step=<T>(key:string,work:(db:D1Database)=>Promise<T>)=>execution.step(key,()=>work(execution.mutationDb(key)));
    if(plan.friendId){
      const friendId=plan.friendId;
      await step('mileage',db=>awardActivityMileage(db,{eventType:'link_clicked',source:'tracked_link',sourceEventId:clickId,
        friendId,subjectKey:plan.linkId,metadata:{trackedLinkId:plan.linkId,linkName:plan.linkName},occurredAt:plan.clickedAt}));
      if(plan.accountId){
        await step('score',db=>applyActionScoreEvent(db,{lineAccountId:plan.accountId!,friendId,eventType:'link_clicked',
          source:'tracked_link',sourceEventId:clickId,subjectKey:plan.linkId,occurredAt:plan.clickedAt}));
        await step('automation',async db=>{
          const outcome=await dispatchAutomationEventWithLogging(db,{lineAccountId:plan.accountId!,eventType:'link_clicked',sourceEventId:clickId,
            friendId,eventData:{trackedLinkId:plan.linkId,clickId}});
          // The dispatcher returns a failed outcome instead of always throwing.
          if(outcome.some(item=>['configuration_error','failed'].includes(item.status ?? '')))throw new Error('automation_failed');
          return outcome;
        });
      }
      for(const id of plan.conversionPointIds)await step(`conversion:${id}`,db=>trackConversion(db,{conversionPointId:id,friendId,
        metadata:JSON.stringify({via:'tracked_link',trackedLinkId:plan.linkId})}));
      if(plan.tagId)await step('tag',db=>attachTagAndFireSideEffects(db,friendId,plan.tagId!,{
        defaultAccessToken:env.LINE_CHANNEL_ACCESS_TOKEN,workerUrl:env.WORKER_URL}));
      if(plan.scenarioId)await step('scenario',db=>enrollFriendInScenario(db,friendId,plan.scenarioId!));
    }
    await execution.complete();
  }catch(error){await execution.fail();throw error;}
}
export async function processDueTrackedClicks(env:Env['Bindings']):Promise<number>{
  const due=await env.DB.prepare(`SELECT subject_id,input_json FROM workflow_steps WHERE process_kind='tracked_click'
    AND step_key='__run' AND attempt_count<max_attempts AND (status IN ('pending','failed') OR (status='running' AND lease_expires_at<=?))
    AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY updated_at LIMIT 50`)
    .bind(Date.now(),Date.now()).all<{subject_id:string;input_json:string}>();
  for(const row of due.results)await processTrackedClick(env,row.subject_id,JSON.parse(row.input_json)).catch(()=>undefined);
  return due.results.length;
}
