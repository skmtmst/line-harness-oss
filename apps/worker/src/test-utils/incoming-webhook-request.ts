import type { Env } from '../worker-env.js';
import { processIncomingWebhookQueue } from '../routes/webhooks.js';
const signed = new Map<string,{timestamp:string;eventId:string}>();
const encoder=new TextEncoder();
export async function signIncomingTest(secret:string,body:string):Promise<string> {
 const timestamp=String(Math.floor(Date.now()/1000));
 const eventId=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(body)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${eventId}.${body}`)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 signed.set(signature,{timestamp,eventId});return signature;
}
/** 受信と別の定期実行を通し、実際の HTTP 応答を保持する。 */
export async function receiveAndDrain(app:{request: (...args:any[])=>Response|Promise<Response>},url:string,init:RequestInit,bindings:object):Promise<Response> {
 if(!url.includes('/receive'))return app.request(url,init,bindings);
 const headers=new Headers(init.headers);
 const signature=headers.get('X-Webhook-Signature')??'';
 const freshness=signed.get(signature)??{timestamp:String(Math.floor(Date.now()/1000)),eventId:'invalid-signature-event'};
 if(!headers.has('X-Webhook-Timestamp'))headers.set('X-Webhook-Timestamp',freshness.timestamp);
 if(!headers.has('X-Webhook-Event-Id'))headers.set('X-Webhook-Event-Id',freshness.eventId);
 const provided=bindings as Partial<Env['Bindings']>;
 const env={...provided,LINE_CREDENTIAL_ENCRYPTION_KEY:provided.LINE_CREDENTIAL_ENCRYPTION_KEY??btoa('q'.repeat(32))} as Env['Bindings'];
 const response=await app.request(url,{...init,headers},env);
 if(response.status===202) {
  // 時刻待ちと回復動作を分けて試すため、キューの再試行予定を到達済みにする。
  await env.DB.prepare("UPDATE incoming_webhook_queue SET next_attempt_at=? WHERE status='pending'").bind(new Date().toISOString()).run();
  await processIncomingWebhookQueue(env);
 }
 return response;
}
