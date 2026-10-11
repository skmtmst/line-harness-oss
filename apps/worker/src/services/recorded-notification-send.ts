import {createBroadcastRetryKey} from './broadcast-retry-key.js';
import {hashOutboundPayload,reserveOutboundSend,completeOutboundSendStatement,failOutboundSend,classifyLineOutboundFailure,type OutboundChannel} from './outbound-idempotency.js';

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
 if(reservation.kind!=='acquired'&&reservation.kind!=='retry')throw new Error('notification_delivery_held');
 let accepted=false;
 try{
  await input.send(key);accepted=true;
  const saved=await completeOutboundSendStatement(db,{key,responseId:key,leaseToken:reservation.leaseToken,now:new Date().toISOString()}).run();
  if(saved.meta.changes!==1)throw new Error('notification_completion_not_saved');
 }catch(error){
  const failure=!accepted&&input.channel==='line'?classifyLineOutboundFailure(error,now):
   {status:'unknown' as const,code:'NOTIFICATION_DELIVERY_UNKNOWN',retryable:false,nextRetryAt:null};
  await failOutboundSend(db,{key,leaseToken:reservation.leaseToken,...failure,now}).catch(()=>undefined);
  throw new Error('notification_delivery_failed');
 }
}
