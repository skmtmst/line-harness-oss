import {createBroadcastRetryKey} from '../features/broadcasts/broadcast-retry-key/index.js';
import {hashOutboundPayload,reserveOutboundSend,completeOutboundSendStatement,failOutboundSend,classifyLineOutboundFailure,type OutboundChannel} from './outbound-idempotency.js';

export class NotificationDeliveryIncomplete extends Error {
 constructor(public readonly deliveryStatus:'failed'|'unknown'){super(`notification_delivery_${deliveryStatus}`)}
}

/** One delivery record per recipient. Uncertain acceptance requires operator review. */
export async function sendRecordedNotification(db:D1Database,input:{
 sourceId:string;channel:OutboundChannel;recipient:string;payload:string;lineAccountId?:string|null;
 send:(retryKey:string)=>Promise<unknown>;
}):Promise<void>{
 const key=await createBroadcastRetryKey('notification',input.sourceId,input.channel,input.recipient);
 const now=new Date().toISOString();
 const reservation=await reserveOutboundSend(db,{key,channel:input.channel,resourceId:input.sourceId,
  payloadHash:await hashOutboundPayload(input.payload),lineAccountId:input.lineAccountId,retryInProgress:false,now});
 if(reservation.kind==='replay')return;
 if(reservation.kind!=='acquired'&&reservation.kind!=='retry')throw new NotificationDeliveryIncomplete(reservation.kind==='failed'||reservation.kind==='conflict'?'failed':'unknown');
 if(reservation.kind==='retry'&&input.channel==='line'){
  const original=await db.prepare('SELECT created_at FROM outbound_send_requests WHERE idempotency_key=?').bind(key).first<{created_at:string}>();
  if(!original||!Number.isFinite(Date.parse(original.created_at))||Date.parse(now)-Date.parse(original.created_at)>=23*3600_000){
   await failOutboundSend(db,{key,leaseToken:reservation.leaseToken,status:'unknown',code:'LINE_RETRY_KEY_EXPIRED',retryable:false,nextRetryAt:null,now});
   throw new NotificationDeliveryIncomplete('unknown');
  }
 }
 let accepted=false;
 try{
  await input.send(key);accepted=true;
  const saved=await completeOutboundSendStatement(db,{key,responseId:key,leaseToken:reservation.leaseToken,now:new Date().toISOString()}).run();
  if(saved.meta.changes!==1)throw new Error('notification_completion_not_saved');
 }catch(error){
  const failure=!accepted&&input.channel==='line'?classifyLineOutboundFailure(error,now):
   {status:'unknown' as const,code:'NOTIFICATION_DELIVERY_UNKNOWN',retryable:false,nextRetryAt:null};
  await failOutboundSend(db,{key,leaseToken:reservation.leaseToken,...failure,now}).catch(()=>undefined);
  throw new NotificationDeliveryIncomplete(failure.status==='unknown'?'unknown':'failed');
 }
}
