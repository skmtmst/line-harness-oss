import type { Env } from '../index.js';
import { getLineAccountById, applyMileageRulesForEvent, getWorkflowStep } from '@line-crm/db';
import { fireEvent } from './event-bus.js';
import type { IncomingWebhookExecution } from './incoming-webhook-receipts.js';
import { acquireWorkflow } from './workflow-execution.js';
import { processVisitStampQueue } from './visit-stamps.js';
import { dbFor } from './db-router.js';
import {featureJobCanRun} from './feature-enforcement.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
export interface RestaurantEvent {
 id:string; reservation_id:string|null;store_id:string;event_type:string;reservation_version:number;
 occurred_at:string;line_account_id:string|null;friend_id:string|null;payload_json:string;
}
export type RestaurantEventConsumer = (db:D1Database,event:RestaurantEvent,execution:IncomingWebhookExecution)=>Promise<void>;
/** 消費者と各工程の記録を別々に持つ。SQL効果も共通workflowの柵と記録で再実行を防ぐ。 */
export async function deliverRestaurantEvent(db:D1Database,event:RestaurantEvent,consumerKey:string,consume:RestaurantEventConsumer):Promise<boolean> {
 const receipt=await db.prepare('SELECT status FROM rt_reservation_event_receipts WHERE event_id=? AND consumer_key=?').bind(event.id,consumerKey).first<{status:string}>();
 if(receipt?.status==='succeeded')return true;
 const run=await acquireWorkflow(db,{scopeId:event.store_id,processKind:'restaurant_event',subjectId:event.id+':'+consumerKey},{maxAttempts:50});
 if(!run){
  const completed=await getWorkflowStep(db,{scopeId:event.store_id,processKind:'restaurant_event',subjectId:event.id+':'+consumerKey,stepKey:'__run'});
  if(completed?.status!=='succeeded')return false;
  await db.prepare("UPDATE rt_reservation_event_receipts SET status='succeeded',lease_until=NULL,result_ref=? WHERE event_id=? AND consumer_key=?").bind(event.id,event.id,consumerKey).run();return true;
 }
 try {
  await db.prepare(`UPDATE rt_reservation_event_receipts SET status='running',attempt_count=attempt_count+1,lease_until=?,lease_owner=?,next_attempt_at=NULL WHERE event_id=? AND consumer_key=?`).bind(new Date(Date.now()+300000).toISOString(),run.owner,event.id,consumerKey).run();
  const domains=new Map<string,D1Database>();
  const owned=new Proxy(db,{get(_target,key){
   const step=run.activeStep??'consume';
   if(!domains.has(step))domains.set(step,run.mutationDb(step));
   const selected=domains.get(step)!;
   const value=Reflect.get(selected,key);return typeof value==='function'?value.bind(selected):value;
  }});
  const execution:IncomingWebhookExecution={db:owned,sourceEventId:event.id,occurredAt:event.occurred_at,
   step:(key,work)=>run.step(key,work,{maxAttempts:50}),complete:async()=>{},fail:async()=>{}};
  await run.step('consume',()=>consume(owned,event,execution),{maxAttempts:50});
  // 完了記録の後で応答が失われても、次回はworkflowの結果を使ってreceiptだけ直す。
  await run.complete();
  await db.prepare(`UPDATE rt_reservation_event_receipts SET status='succeeded',lease_until=NULL,result_ref=? WHERE event_id=? AND consumer_key=? AND lease_owner=?`).bind(event.id,event.id,consumerKey,run.owner).run();
  return true;
 }catch(error){
  await run.fail();
  await db.prepare(`UPDATE rt_reservation_event_receipts SET status='failed',lease_until=NULL,next_attempt_at=? WHERE event_id=? AND consumer_key=? AND lease_owner=? AND status<>'succeeded'`).bind(new Date(Date.now()+60000).toISOString(),event.id,consumerKey,run.owner).run();
  return false;
 }
}
export async function processRestaurantEvents(env:Env['Bindings'],storeId?:string) {
 if(!restaurantTestEnabled(env))return;
 const db=dbFor(env);
 const rows=await db.prepare(`SELECT e.*,r.consumer_key FROM rt_reservation_events e JOIN rt_reservation_event_receipts r ON r.event_id=e.id
 WHERE r.status<>'succeeded' AND (? IS NULL OR e.store_id=?) AND (r.next_attempt_at IS NULL OR julianday(r.next_attempt_at)<=julianday('now')) ORDER BY e.occurred_at,e.reservation_version LIMIT 100`).bind(storeId??null,storeId??null).all<RestaurantEvent&{consumer_key:string}>();
 for(const event of rows.results)await deliverRestaurantEvent(db,event,event.consumer_key,async(owned,e,execution)=>{
  if(event.consumer_key==='visit_stamp_queue') {
   await processVisitStampQueue(env);
   if(await db.prepare("SELECT 1 FROM visit_stamp_visit_queue WHERE kind='restaurant' AND visit_id=?").bind(e.reservation_id).first())throw new Error('stamp_queue_pending');
   return;
  }
  if(!e.line_account_id||!e.friend_id)return;
  // 発生時の所属を固定。後日別アカウントへ移った友だちには配送しない。
  const friend=await db.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=? AND is_following=1').bind(e.friend_id,e.line_account_id).first();if(!friend)return;
  const data=JSON.parse(e.payload_json) as Record<string,unknown>;
  if(event.consumer_key==='mileage') {
   if(!await featureJobCanRun(db,{accountId:e.line_account_id,featureId:'mileage',job:'restaurant events mileage'}))return;
   await applyMileageRulesForEvent(owned,{eventType:e.event_type,source:'restaurant',sourceEventId:e.id,friendId:e.friend_id,subjectKey:e.reservation_id,metadata:data,occurredAt:e.occurred_at});return;
  }
  const account=await getLineAccountById(db,e.line_account_id);if(!account?.is_active||account.archived_at)return;
  // fireEvent のルール・アクション別のstepを独立したreceiptへ分ける。
  await fireEvent(owned,e.event_type,{sourceEventId:e.id,sourceKind:'restaurant',occurredAt:e.occurred_at,friendId:e.friend_id,eventData:data},account.channel_access_token,e.line_account_id,execution,env.LINE_CREDENTIAL_ENCRYPTION_KEY,{internalOnly:true});
 });
}
