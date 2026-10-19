import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {passCheckout,passBillingEvent,expirePassGrace,type PassBillingEvent} from '../features/booking/booking-pass-billing.js';
import {bookingPassBilling} from './booking-pass-billing.js';
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
