import {createBroadcastRetryKey} from '../features/broadcasts/broadcast-retry-key/index.js';
import {hashOutboundPayload,reserveOutboundSend,completeOutboundSendStatement,failOutboundSend,classifyLineOutboundFailure,type OutboundChannel} from './outbound-idempotency.js';

export class NotificationDeliveryIncomplete extends Error {
 constructor(public readonly deliveryStatus:'failed'|'unknown',public readonly blockedReason?:string){super(`notification_delivery_${deliveryStatus}`)}
}
/** 外部要求を始める前の照合で止めた。受理不明とは区別し、復旧後は再照合できる。 */
export class NotificationDeliveryBlocked extends Error {}

/** 受信者ごとに配送を記録し、受理が不明なら運用者へ照合を求める。 */
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
 if(reservation.kind==='retry'&&input.channel==='line'&&reservation.previousFailureCode!=='NOTIFICATION_PRECONDITION_CHANGED'){
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
  // 以前の外部要求の痕跡を、後の送信前の停止で消さない。
  const blockedCode=reservation.kind==='retry'&&reservation.previousFailureCode!=='NOTIFICATION_PRECONDITION_CHANGED'
   ?reservation.previousFailureCode??'OUTBOUND_SEND_FAILED':'NOTIFICATION_PRECONDITION_CHANGED';
  const failure=!accepted&&error instanceof NotificationDeliveryBlocked?
   {status:'failed' as const,code:blockedCode,retryable:true,nextRetryAt:null}:
   !accepted&&input.channel==='line'?classifyLineOutboundFailure(error,now):
   {status:'unknown' as const,code:'NOTIFICATION_DELIVERY_UNKNOWN',retryable:false,nextRetryAt:null};
  await failOutboundSend(db,{key,leaseToken:reservation.leaseToken,...failure,now}).catch(()=>undefined);
  throw new NotificationDeliveryIncomplete(failure.status==='unknown'?'unknown':'failed',!accepted&&error instanceof NotificationDeliveryBlocked?error.message:undefined);
 }
}
