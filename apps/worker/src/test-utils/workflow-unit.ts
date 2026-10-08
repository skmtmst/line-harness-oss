// Unit route suites use stub databases. Durable leases and recovery are exercised separately against SQLite.
import type {WorkflowExecution} from '../services/workflow-execution.js';
export function unitWorkflow(db:D1Database,ref:{scopeId:string;processKind:string;subjectId:string}):WorkflowExecution{
 return {db,ref:{...ref,stepKey:'__run'},owner:'unit-owner',sourceEventId:ref.subjectId,occurredAt:'2026-01-01T00:00:00Z',
  mutationDb:()=>db,step:async(_key,work)=>work(),complete:async()=>{},fail:async()=>{},release:async()=>{}};
}
export async function unitLineEvents(input:{db:D1Database;events:Array<{webhookEventId:string;type:string}>;lineAccountId:string|null;handle:Function},ledger:Record<string,Function>){
 for(const event of input.events){
  let allowed=true;
  if(Object.prototype.hasOwnProperty.call(ledger,'reserveLineWebhookEvent')){
   for(let attempt=0;attempt<2;attempt++)try{
    allowed=await ledger.reserveLineWebhookEvent(input.db,{webhookEventId:event.webhookEventId,lineAccountId:input.lineAccountId,eventType:event.type});break;
   }catch{allowed=false}
  }
  if(!allowed)continue;
  try{await input.handle(event,unitWorkflow(input.db,{scopeId:`line:${input.lineAccountId ?? 'default'}`,processKind:'line_event',subjectId:event.webhookEventId}));
   if(Object.prototype.hasOwnProperty.call(ledger,'markLineWebhookEventSucceeded'))await ledger.markLineWebhookEventSucceeded(input.db,event.webhookEventId);
  }catch{if(Object.prototype.hasOwnProperty.call(ledger,'markLineWebhookEventFailed'))await ledger.markLineWebhookEventFailed(input.db,event.webhookEventId,'unknown')}
 }
}
