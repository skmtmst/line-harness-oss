import {GapError} from '../../services/gap-common.js';
import {sha256Hex} from '../../middleware/auth.js';
import {assertChanged,clearAssertions} from './booking-series.js';
export async function passCheckout(db:D1Database,a:string,f:string,plan:string,key:string,testMode:unknown,now=new Date()){
 if(testMode!==true)throw new GapError('test_mode_required',409);
 const id='pass-buy-'+await sha256Hex(JSON.stringify([a,f,key]));
 const old=await db.prepare('SELECT * FROM booking_pass_purchases WHERE id=? AND account_id=? AND friend_id=?').bind(id,a,f).first<Record<string,unknown>>();
 if(old){if(old.plan_id!==plan)throw new GapError('idempotency_conflict',409);return purchaseView(old,true);}
 const p=await db.prepare("SELECT p.* FROM booking_pass_plans p JOIN line_accounts a ON a.id=p.line_account_id JOIN tenants t ON t.id=a.tenant_id WHERE p.id=? AND p.line_account_id=? AND p.status='on_sale' AND a.is_active=1 AND a.archived_at IS NULL AND t.status='active'").bind(plan,a).first<Record<string,unknown>>();if(!p)throw new GapError('plan_unavailable',409);
 const snapshot=JSON.stringify({kind:p.kind,name:p.name,count:p.count,monthlyLimit:p.monthly_limit,validDays:p.valid_days,menuIds:JSON.parse(String(p.target_scope_json)),price:p.price});
 await db.prepare(`INSERT INTO booking_pass_purchases(id,account_id,friend_id,plan_id,amount,snapshot_json,request_key,checkout_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM booking_pass_plans p JOIN line_accounts a ON a.id=p.line_account_id JOIN tenants t ON t.id=a.tenant_id WHERE p.id=? AND p.line_account_id=? AND p.status='on_sale' AND p.version=? AND a.is_active=1 AND a.archived_at IS NULL AND t.status='active') AND EXISTS(SELECT 1 FROM friends WHERE id=? AND line_account_id=?) ON CONFLICT(id) DO NOTHING`).bind(id,a,f,plan,p.price,snapshot,key,'cs_test_'+id.slice(-40),now.toISOString(),plan,a,p.version,f,a).run();
 const row=await db.prepare('SELECT * FROM booking_pass_purchases WHERE id=?').bind(id).first<Record<string,unknown>>();if(!row)throw new GapError('plan_changed',409);if(row.plan_id!==plan)throw new GapError('idempotency_conflict',409);return purchaseView(row,false);
}
export function purchaseView(r:Record<string,unknown>,replayed=false){return {id:r.id,planId:r.plan_id,amount:r.amount,status:r.status,checkoutId:r.checkout_id,checkoutUrl:null,checkoutAvailable:false,simulationAvailable:true,entitlementId:r.entitlement_id,testMode:true,replayed};}
export type PassBillingEvent={id:string;kind:'checkout.session.completed'|'invoice.paid'|'invoice.payment_failed'|'customer.subscription.deleted';checkoutId?:string;subscriptionId?:string;invoiceId?:string;amount?:number;currency?:string;periodStart:string;periodEnd:string;occurredAt:string;testMode:true};
export async function passBillingEvent(db:D1Database,b:PassBillingEvent,now=new Date()){
 const kinds=['checkout.session.completed','invoice.paid','invoice.payment_failed','customer.subscription.deleted'];
 if(b?.testMode!==true||!kinds.includes(b.kind)||typeof b.id!=='string'||!/^[-\w:]{1,128}$/.test(b.id)||![b.periodStart,b.periodEnd,b.occurredAt].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)))||Date.parse(b.periodEnd)<=Date.parse(b.periodStart)||Date.parse(b.occurredAt)>now.getTime()+300000)throw new GapError('invalid_test_event');
 b={...b,periodStart:new Date(b.periodStart).toISOString(),periodEnd:new Date(b.periodEnd).toISOString(),occurredAt:new Date(b.occurredAt).toISOString()};
 const request=JSON.stringify(b),old=await db.prepare('SELECT request_json,result FROM booking_pass_billing_events WHERE event_id=?').bind(b.id).first<{request_json:string;result:string}>();
 if(old){if(old.request_json!==request)throw new GapError('idempotency_conflict',409);return {replayed:true,result:old.result,testMode:true};}
 const checkout=b.kind==='checkout.session.completed';
 const p=await db.prepare(checkout?'SELECT * FROM booking_pass_purchases WHERE checkout_id=? AND test_mode=1':'SELECT * FROM booking_pass_purchases WHERE subscription_id=? AND status=\'paid\' AND test_mode=1').bind(checkout?b.checkoutId??'':b.subscriptionId??'').first<Record<string,unknown>>();if(!p)throw new GapError('purchase_not_found',404);
 const snapshot=JSON.parse(String(p.snapshot_json)) as {kind:string;name:string;count:number|null;monthlyLimit:number|null;validDays:number};
 if(checkout||b.kind==='invoice.paid')if(b.currency!=='jpy'||b.amount!==p.amount)throw new GapError('payment_amount_mismatch',409);
 if(snapshot.kind==='monthly'&&(!b.subscriptionId||!/^sub_[\w-]{1,150}$/.test(b.subscriptionId)))throw new GapError('subscription_required');
 if(!checkout&&snapshot.kind!=='monthly')throw new GapError('subscription_required');
 if(!checkout&&Date.parse(b.periodEnd)<=Date.parse(b.occurredAt)&&b.kind==='invoice.paid')throw new GapError('invalid_period');
 const ent='pass-ent-'+p.id,at=now.toISOString(),grace=new Date(Date.parse(b.occurredAt)+7*86400000).toISOString(),expiry=snapshot.kind==='monthly'?b.periodEnd:new Date(Date.parse(b.occurredAt)+snapshot.validDays*86400000).toISOString();
 const ops=[db.prepare("INSERT INTO booking_pass_billing_events(event_id,purchase_id,subscription_id,invoice_id,kind,period_start,period_end,occurred_at,request_json,result) VALUES(?,?,?,?,?,?,?,?,?,'recorded') ON CONFLICT(event_id) DO NOTHING").bind(b.id,p.id,b.subscriptionId??null,b.invoiceId??null,b.kind,b.periodStart,b.periodEnd,b.occurredAt,request),assertChanged(db)];
 if(checkout){
  ops.push(db.prepare(`INSERT INTO booking_entitlements(id,line_account_id,friend_id,kind,name,remaining,monthly_limit,valid_from,expires_at,created_at,updated_at,plan_id,source,stripe_subscription_id)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'online',? WHERE EXISTS(SELECT 1 FROM booking_pass_purchases WHERE id=? AND status='pending')`).bind(ent,p.account_id,p.friend_id,snapshot.kind,snapshot.name,snapshot.count,snapshot.monthlyLimit,b.occurredAt,expiry,at,at,p.plan_id,snapshot.kind==='monthly'?b.subscriptionId:null,p.id),
 db.prepare("UPDATE booking_pass_purchases SET status='paid',entitlement_id=?,subscription_id=?,paid_at=? WHERE id=? AND status='pending'").bind(ent,snapshot.kind==='monthly'?b.subscriptionId:null,b.occurredAt,p.id));
 }else{
  const graceSql="(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(julianday(occurred_at))+7) FROM booking_pass_billing_events WHERE purchase_id=? AND period_start=? AND kind='invoice.payment_failed')";
  const billing=b.kind==='invoice.paid'?'ok':b.kind==='invoice.payment_failed'?(Date.parse(grace)>now.getTime()?'grace':'stopped'):'stopped';
  ops.push(db.prepare(`UPDATE booking_entitlements SET billing_status=CASE WHEN ?='invoice.payment_failed' THEN CASE WHEN julianday(${graceSql})<=julianday(?) THEN 'stopped' ELSE 'grace' END ELSE ? END,grace_until=CASE WHEN ?='invoice.payment_failed' THEN ${graceSql} ELSE NULL END,expires_at=CASE WHEN ?='invoice.paid' THEN MAX(expires_at,?) WHEN ?='invoice.payment_failed' THEN MAX(expires_at,${graceSql}) ELSE expires_at END,version=version+1,updated_at=? WHERE id=? AND source='online'
 AND NOT EXISTS(SELECT 1 FROM booking_pass_billing_events e WHERE e.purchase_id=? AND e.event_id<>? AND (julianday(e.period_start)>julianday(?) OR e.period_start=? AND (julianday(e.occurred_at)>julianday(?) AND NOT(e.kind='invoice.payment_failed' AND ?='invoice.paid') OR e.kind='invoice.paid' AND ?='invoice.payment_failed' OR e.occurred_at=? AND e.kind='customer.subscription.deleted')))`)
 .bind(b.kind,p.id,b.periodStart,at,billing,b.kind,p.id,b.periodStart,b.kind,b.periodEnd,b.kind,p.id,b.periodStart,at,p.entitlement_id,p.id,b.id,b.periodStart,b.periodStart,b.occurredAt,b.kind,b.kind,b.occurredAt));
 }
 ops.push(db.prepare("UPDATE booking_pass_billing_events SET result=CASE WHEN changes()=1 THEN 'applied' ELSE 'ignored' END WHERE event_id=?").bind(b.id));
 // The existing entitlement history uses a stable event key and remains inside the same transaction.
 ops.push(db.prepare(`INSERT INTO booking_entitlement_events(id,entitlement_id,line_account_id,action,reason,actor_type,actor_id,request_key,request_json,after_json,created_at)
 SELECT ?,e.id,e.line_account_id,?,?,'system','stripe-test',?,?,json_object('billingStatus',e.billing_status,'remaining',e.remaining,'graceUntil',e.grace_until,'testMode',1),? FROM booking_entitlements e WHERE e.id=? AND EXISTS(SELECT 1 FROM booking_pass_billing_events WHERE event_id=? AND result='applied')`).bind(crypto.randomUUID(),checkout?'grant':'adjust',checkout?'試験のオンライン購入':'試験の月謝の支払い更新','stripe-pass:'+b.id,request,at,checkout?ent:p.entitlement_id,b.id),clearAssertions(db));
 try{await db.batch(ops);}catch(e){const saved=await db.prepare('SELECT request_json,result FROM booking_pass_billing_events WHERE event_id=?').bind(b.id).first<{request_json:string;result:string}>();if(saved?.request_json===request)return {replayed:true,result:saved.result,testMode:true};throw e;}
 const saved=await db.prepare('SELECT result FROM booking_pass_billing_events WHERE event_id=?').bind(b.id).first<{result:string}>();return {replayed:false,result:saved!.result,testMode:true};
}
export async function expirePassGrace(db:D1Database,now=new Date()){
 return db.prepare("UPDATE booking_entitlements SET billing_status='stopped',version=version+1,updated_at=? WHERE source='online' AND billing_status='grace' AND julianday(grace_until)<=julianday(?)").bind(now.toISOString(),now.toISOString()).run();
}
