import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {passCheckout,passBillingEvent,expirePassGrace,type PassBillingEvent} from '../features/booking/booking-pass-billing.js';
import {bookingPassBilling} from './booking-pass-billing.js';
import {bookingPassPlans} from './booking-pass-plans.js';
import {passUnusable} from '../features/booking/booking-pass-plans.js';
import {isPublicApiBoundary} from '../middleware/public-api-boundary.js';
vi.mock('./booking.js',async importOriginal=>({...await importOriginal<any>(),resolveAccountIdFromLiff:async(c:any)=>c.req.query('liffId')==='liff-a'?'a':null,verifyCallerLineUserId:async(c:any)=>c.req.header('authorization')==='Bearer customer'?'Uf':null,resolveFriendId:async()=> 'f'}));
let d:ReturnType<typeof gapFixture>;const now=new Date('2026-10-16T03:00:00Z');
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));for(const [id,kind] of [['ticket','ticket'],['monthly','monthly']])d.raw.prepare("INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,monthly_limit,valid_days,status,created_by,created_at,idempotency_key,request_json) VALUES(?,'a',?,?,3000,?,?,180,'on_sale','o','now',?,'{}')").run(id,kind,id,kind==='ticket'?10:null,kind==='monthly'?4:null,id);});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();vi.useRealTimers();});
async function buy(kind='ticket'){
 const p=await passCheckout(d.db,'a','f',kind,'buy-'+kind,true,now);
 const event:PassBillingEvent={id:'checkout-'+kind,kind:'checkout.session.completed',checkoutId:String(p.checkoutId),...(kind==='monthly'?{subscriptionId:'sub_test_monthly'}:{}),amount:3000,currency:'jpy',periodStart:now.toISOString(),periodEnd:'2026-11-16T03:00:00Z',occurredAt:now.toISOString(),testMode:true};
 return {p,event};
}
async function billingSummary(account='a',staff=gapOwner){
 const response=await gapCall(gapApp(d,[bookingPassPlans],staff),`/api/booking/admin/pass-plans?account_id=${account}`);
 expect(response.status).toBe(200);return (await response.json() as any).data.summary;
}
test('B2-23: 価格と券はサーバー側の控え、同じ支払い・再送・別IDの重複通知で券は1枚',async()=>{
 const {p,event}=await buy();expect(p).toMatchObject({checkoutUrl:null,checkoutAvailable:false,simulationAvailable:true,amount:3000,testMode:true});expect((await buy()).p.id).toBe(p.id);
 d.raw.exec("UPDATE booking_pass_plans SET price=9000,count=99 WHERE id='ticket'");
 expect(await passBillingEvent(d.db,event,now)).toMatchObject({result:'applied'});expect(await passBillingEvent(d.db,event,now)).toMatchObject({replayed:true});await passBillingEvent(d.db,{...event,id:'checkout-repeat'},now);
 expect(d.raw.prepare('SELECT count(*) n FROM booking_entitlements').get()).toEqual({n:1});expect(d.raw.prepare('SELECT remaining,source FROM booking_entitlements').get()).toEqual({remaining:10,source:'online'});expect(d.raw.prepare('SELECT count(*) n FROM booking_entitlement_events').get()).toEqual({n:1});
 await expect(passBillingEvent(d.db,{...event,amount:1},now)).rejects.toMatchObject({code:'idempotency_conflict'});await expect(passCheckout(d.db,'a','f','monthly','buy-ticket',true,now)).rejects.toMatchObject({code:'idempotency_conflict'});
});
test('B2-24/25: 7日猶予・期限後停止・払い直し回復、古い失敗と古い周期で成功を戻さない',async()=>{
 const {event}=await buy('monthly');await passBillingEvent(d.db,event,now);
 const failed:PassBillingEvent={id:'failed',kind:'invoice.payment_failed',subscriptionId:'sub_test_monthly',invoiceId:'in_test',periodStart:'2026-11-16T03:00:00Z',periodEnd:'2026-12-16T03:00:00Z',occurredAt:'2026-11-16T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,failed,new Date(failed.occurredAt));expect(d.raw.prepare('SELECT billing_status,grace_until FROM booking_entitlements').get()).toEqual({billing_status:'grace',grace_until:'2026-11-23T03:00:00.000Z'});
 await expirePassGrace(d.db,new Date('2026-11-23T02:59:59Z'));expect(d.raw.prepare('SELECT billing_status FROM booking_entitlements').get()).toEqual({billing_status:'grace'});
 await expirePassGrace(d.db,new Date('2026-11-23T03:00:00Z'));expect(d.raw.prepare('SELECT billing_status FROM booking_entitlements').get()).toEqual({billing_status:'stopped'});
 const paid:PassBillingEvent={...failed,id:'paid',kind:'invoice.paid',amount:3000,currency:'jpy',occurredAt:'2026-11-24T03:00:00Z'};await passBillingEvent(d.db,paid,new Date(paid.occurredAt));expect(d.raw.prepare('SELECT billing_status,grace_until FROM booking_entitlements').get()).toEqual({billing_status:'ok',grace_until:null});
 await passBillingEvent(d.db,{...failed,id:'late-failure'},new Date(paid.occurredAt));await passBillingEvent(d.db,{...failed,id:'old-cycle',periodStart:now.toISOString()},new Date(paid.occurredAt));expect(d.raw.prepare('SELECT billing_status FROM booking_entitlements').get()).toEqual({billing_status:'ok'});
});
test('B2-23/24: 署名・live・金額・本人・店・権限を検証、失敗したbatchは購入も券も戻す',async()=>{
 const {p,event}=await buy();await expect(passBillingEvent(d.db,{...event,amount:1},now)).rejects.toMatchObject({code:'payment_amount_mismatch'});
 d.raw.exec("CREATE TRIGGER issue_fail BEFORE INSERT ON booking_entitlement_events BEGIN SELECT RAISE(ABORT,'issue failure');END");await expect(passBillingEvent(d.db,event,now)).rejects.toThrow('issue failure');expect(d.raw.prepare('SELECT status FROM booking_pass_purchases').get()).toEqual({status:'pending'});expect(d.raw.prepare('SELECT count(*) n FROM booking_entitlements').get()).toEqual({n:0});d.raw.exec('DROP TRIGGER issue_fail');
 const app=gapApp(d,[bookingPassBilling]);expect((await gapCall(app,'/api/liff/booking/pass-plans/ticket/checkout?liffId=liff-a','POST',{testMode:true})).status).toBe(401);
 const liff=await app.request('/api/liff/booking/pass-plans/ticket/checkout?liffId=liff-a',{method:'POST',headers:{Authorization:'Bearer customer','Content-Type':'application/json','Idempotency-Key':'liff-buy'},body:JSON.stringify({testMode:true,price:1})});expect(liff.status).toBe(400);
 for(const [staff,im] of [[{...gapOwner,readOnly:true},false],[{...gapOwner,role:'staff' as const},false],[gapOwner,true]] as const)expect((await gapCall(gapApp(d,[bookingPassBilling],staff,im),'/api/booking/admin/pass-purchases/simulate-event?account_id=a','POST',event)).status).toBe(403);
 const webhook='/api/booking/pass-payments/webhook';expect(isPublicApiBoundary('POST',webhook)).toBe(true);expect(isPublicApiBoundary('GET',webhook)).toBe(false);
 expect((await gapCall(app,webhook,'POST',{})).status).toBe(401);
 const send=async(live:boolean)=>{const t=Math.floor(Date.now()/1000),payload=JSON.stringify({id:'signed',type:'checkout.session.completed',created:t,livemode:live,data:{object:{id:p.checkoutId,payment_status:'paid',amount_total:3000,currency:'jpy'}}});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-webhook-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+payload))),b=>b.toString(16).padStart(2,'0')).join('');return app.request(webhook,{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`,'Content-Type':'application/json'},body:payload});};
 expect((await send(true)).status).toBe(409);const signed=await send(false);expect(signed.status,await signed.clone().text()).toBe(200);
});

test('B2-24/25: 再試行の失敗で7日を延長しない、同じ周期の支払い済みを失敗で戻さない',async()=>{
 const {event}=await buy('monthly');await passBillingEvent(d.db,event,now);
 const failed:PassBillingEvent={id:'first-fail',kind:'invoice.payment_failed',subscriptionId:'sub_test_monthly',periodStart:'2026-11-16T03:00:00Z',periodEnd:'2026-12-16T03:00:00Z',occurredAt:'2026-11-16T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,failed,new Date(failed.occurredAt));await passBillingEvent(d.db,{...failed,id:'retry-fail',occurredAt:'2026-11-21T03:00:00Z'},new Date('2026-11-21T03:00:00Z'));
 expect(d.raw.prepare('SELECT grace_until FROM booking_entitlements').get()).toEqual({grace_until:'2026-11-23T03:00:00.000Z'});
 const paid:PassBillingEvent={...failed,id:'paid-before-retry',kind:'invoice.paid',amount:3000,currency:'jpy',occurredAt:'2026-11-20T03:00:00Z'};await passBillingEvent(d.db,paid,new Date('2026-11-21T03:00:00Z'));expect(d.raw.prepare('SELECT billing_status FROM booking_entitlements').get()).toEqual({billing_status:'ok'});
 await passBillingEvent(d.db,{...failed,id:'fail-after-paid',occurredAt:'2026-11-22T03:00:00Z'},new Date('2026-11-22T03:00:00Z'));expect(d.raw.prepare('SELECT billing_status FROM booking_entitlements').get()).toEqual({billing_status:'ok'});
});

test('B2-23: 停止・保管した店と統括では新しい模擬購入も作れない',async()=>{
 d.raw.exec("UPDATE tenants SET status='suspended' WHERE id='t'");await expect(passCheckout(d.db,'a','f','ticket','stopped-tenant',true,now)).rejects.toMatchObject({code:'plan_unavailable'});
 d.raw.exec("UPDATE tenants SET status='active' WHERE id='t';UPDATE line_accounts SET is_active=0 WHERE id='a'");await expect(passCheckout(d.db,'a','f','ticket','stopped-store',true,now)).rejects.toMatchObject({code:'plan_unavailable'});expect(d.raw.prepare('SELECT count(*) n FROM booking_pass_purchases').get()).toEqual({n:0});
});

test('試験の請求失敗と正常解約を分け、未接続の実課金を失敗や0件にしない',async()=>{
 const {event}=await buy('monthly');await passBillingEvent(d.db,event,now);
 const summary=()=>billingSummary();
 expect(await summary()).toMatchObject({billingFailed:null,billingStatus:'unconfigured',billingSimulationFailed:0,billingSimulationCancelled:0});
 const failed:PassBillingEvent={id:'summary-failed',kind:'invoice.payment_failed',subscriptionId:'sub_test_monthly',periodStart:'2026-11-16T03:00:00Z',periodEnd:'2026-12-16T03:00:00Z',occurredAt:'2026-11-16T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,failed,new Date(failed.occurredAt));
 expect(await summary()).toMatchObject({billingFailed:null,billingSimulationFailed:1,billingSimulationCancelled:0});
 await expirePassGrace(d.db,new Date('2026-11-24T03:00:00Z'));
 expect(await summary()).toMatchObject({billingSimulationFailed:1,billingSimulationCancelled:0});
 await passBillingEvent(d.db,{...failed,id:'summary-cancelled',kind:'customer.subscription.deleted',occurredAt:'2026-11-25T03:00:00Z'},new Date('2026-11-25T03:00:00Z'));
 expect(await summary()).toMatchObject({billingFailed:null,billingSimulationFailed:0,billingSimulationCancelled:1});
 expect(d.raw.prepare('SELECT remaining,billing_status FROM booking_entitlements').get()).toEqual({remaining:null,billing_status:'stopped'});
});

test('払い直しと遅着した失敗通知では、回復した月謝を試験失敗へ戻さない',async()=>{
 const {event}=await buy('monthly');await passBillingEvent(d.db,event,now);
 const failed:PassBillingEvent={id:'summary-first-failure',kind:'invoice.payment_failed',subscriptionId:'sub_test_monthly',periodStart:'2026-11-16T03:00:00Z',periodEnd:'2026-12-16T03:00:00Z',occurredAt:'2026-11-16T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,failed,new Date(failed.occurredAt));
 await passBillingEvent(d.db,{...failed,id:'summary-retry-failure',occurredAt:'2026-11-21T03:00:00Z'},new Date('2026-11-21T03:00:00Z'));
 expect(await billingSummary()).toMatchObject({billingSimulationFailed:1,billingSimulationCancelled:0});
 // 再試行の通知より前の支払い成功が後から届いても、現在の回復を優先する。
 await passBillingEvent(d.db,{...failed,id:'summary-recovered',kind:'invoice.paid',amount:3000,currency:'jpy',occurredAt:'2026-11-20T03:00:00Z'},new Date('2026-11-21T03:00:00Z'));
 expect(await billingSummary()).toMatchObject({billingFailed:null,billingSimulationFailed:0,billingSimulationCancelled:0});
 expect(await passBillingEvent(d.db,{...failed,id:'summary-ignored-future-failure',occurredAt:'2026-11-22T03:00:00Z'},new Date('2026-11-22T03:00:00Z'))).toMatchObject({result:'ignored'});
 expect(await billingSummary()).toMatchObject({billingSimulationFailed:0,billingSimulationCancelled:0});
});

test('請求失敗のない正常解約は、重複通知でも試験失敗に数えない',async()=>{
 const {event}=await buy('monthly');await passBillingEvent(d.db,event,now);
 const cancelled:PassBillingEvent={id:'summary-normal-cancel',kind:'customer.subscription.deleted',subscriptionId:'sub_test_monthly',periodStart:now.toISOString(),periodEnd:event.periodEnd,occurredAt:'2026-10-20T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,cancelled,new Date(cancelled.occurredAt));
 await passBillingEvent(d.db,cancelled,new Date(cancelled.occurredAt));
 expect(await billingSummary()).toMatchObject({billingFailed:null,billingStatus:'unconfigured',billingSimulationFailed:0,billingSimulationCancelled:1});
});

test('別店舗の試験失敗と、手で止めた券を課金失敗へ混ぜない',async()=>{
 d.raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES('fb','Ufb','b');
 INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,monthly_limit,valid_days,status,created_by,created_at,idempotency_key,request_json)
 SELECT 'monthly-b','b',kind,name,price,count,monthly_limit,valid_days,status,created_by,created_at,'monthly-b',request_json FROM booking_pass_plans WHERE id='monthly'`);
 const other=await passCheckout(d.db,'b','fb','monthly-b','buy-other',true,now);
 await passBillingEvent(d.db,{id:'summary-other-checkout',kind:'checkout.session.completed',checkoutId:String(other.checkoutId),subscriptionId:'sub_test_other',amount:3000,currency:'jpy',periodStart:now.toISOString(),periodEnd:'2026-11-16T03:00:00Z',occurredAt:now.toISOString(),testMode:true},now);
 const failed:PassBillingEvent={id:'summary-other-failure',kind:'invoice.payment_failed',subscriptionId:'sub_test_other',periodStart:'2026-11-16T03:00:00Z',periodEnd:'2026-12-16T03:00:00Z',occurredAt:'2026-11-16T03:00:00Z',testMode:true};
 await passBillingEvent(d.db,failed,new Date(failed.occurredAt));
 const {event}=await buy();await passBillingEvent(d.db,event,now);
 d.raw.exec("UPDATE booking_entitlements SET billing_status='stopped' WHERE line_account_id='a'");
 expect(await billingSummary()).toMatchObject({billingFailed:null,billingSimulationFailed:0,billingSimulationCancelled:0});
 expect(await billingSummary('b',{...gapOwner,tenantId:'other'})).toMatchObject({billingSimulationFailed:1,billingSimulationCancelled:0});
});
