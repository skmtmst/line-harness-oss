import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {GapError,gapAccount,gapBody,gapKey,gapWrite} from '../services/gap-common.js';
import {requirePermission} from '../middleware/role-guard.js';
import {resolveAccountIdFromLiff,verifyCallerLineUserId,resolveFriendId} from './booking.js';
import {passCheckout,passBillingEvent,purchaseView,type PassBillingEvent} from '../features/booking/booking-pass-billing/index.js';
import {readBodyWithinLimit,verifyStripeSignature} from '../services/stripe-signature.js';
export const bookingPassBilling=new Hono<Env>();
bookingPassBilling.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'pass_billing_unavailable'},e instanceof GapError?e.status:503));
bookingPassBilling.post('/api/liff/booking/pass-plans/:id/checkout',async c=>{
 const a=await resolveAccountIdFromLiff(c),user=await verifyCallerLineUserId(c);if(!a||!user)throw new GapError('unauthorized',401);const f=await resolveFriendId(c,user,a);if(!f)throw new GapError('not_found',404);
 const b=await gapBody(c);if(Object.keys(b).some(k=>k!=='testMode'))throw new GapError('invalid_checkout');
 return c.json({success:true,data:await passCheckout(c.env.DB,a,f,c.req.param('id'),gapKey(c),b.testMode)},201);
});
bookingPassBilling.get('/api/liff/booking/pass-purchases/:id',async c=>{
 const a=await resolveAccountIdFromLiff(c),user=await verifyCallerLineUserId(c);if(!a||!user)throw new GapError('unauthorized',401);const f=await resolveFriendId(c,user,a);
 const row=await c.env.DB.prepare('SELECT * FROM booking_pass_purchases WHERE id=? AND account_id=? AND friend_id=?').bind(c.req.param('id'),a,f).first<Record<string,unknown>>();if(!row)throw new GapError('not_found',404);return c.json({success:true,data:purchaseView(row)});
});
bookingPassBilling.get('/api/booking/admin/pass-purchases',requirePermission('/booking/bookings'),async c=>{
 const a=await gapAccount(c);const items=(await c.env.DB.prepare('SELECT p.id,p.plan_id planId,p.amount,p.status,p.entitlement_id entitlementId,e.billing_status billingStatus,e.grace_until graceUntil,p.test_mode testMode FROM booking_pass_purchases p LEFT JOIN booking_entitlements e ON e.id=p.entitlement_id WHERE p.account_id=? ORDER BY p.created_at DESC LIMIT 100').bind(a).all()).results;return c.json({success:true,data:{items}});
});
bookingPassBilling.post('/api/booking/admin/pass-purchases/simulate-event',requirePermission('/booking/bookings'),async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c);
 const event=b as unknown as PassBillingEvent;
 const row=await c.env.DB.prepare("SELECT id FROM booking_pass_purchases WHERE account_id=? AND (CASE WHEN ?='checkout.session.completed' THEN checkout_id=? ELSE subscription_id=? END)").bind(a,event.kind,event.checkoutId??null,event.subscriptionId??null).first();if(!row)throw new GapError('not_found',404);
 return c.json({success:true,data:await passBillingEvent(c.env.DB,event)});
});
/** Dedicated signed test webhook; no live mode or external Stripe writes. */
bookingPassBilling.post('/api/booking/pass-payments/webhook',async c=>{
 const raw=await readBodyWithinLimit(c.req.raw),secret=c.env.STRIPE_TEST_WEBHOOK_SECRET;if(raw===null)throw new GapError('body_too_large');
 if(!secret||!await verifyStripeSignature(secret,raw,c.req.header('stripe-signature')??''))throw new GapError('invalid_signature',401);
 let event;try{event=JSON.parse(raw);}catch{throw new GapError('invalid_body');}
 if(event.livemode!==false||event.data?.object?.livemode===true)throw new GapError('live_mode_forbidden',409);
 const o=event.data?.object;if(!o||typeof event.created!=='number')throw new GapError('invalid_test_event');
 const date=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?new Date(n*1000).toISOString():'';
 if(event.type==='checkout.session.completed'&&o.payment_status!=='paid')throw new GapError('payment_not_paid',409);
 return c.json({success:true,data:await passBillingEvent(c.env.DB,{id:event.id,kind:event.type,checkoutId:o.id,subscriptionId:o.subscription??(event.type==='customer.subscription.deleted'?o.id:undefined),invoiceId:event.type?.startsWith('invoice.')?o.id:undefined,amount:o.amount_total??o.amount_paid,currency:o.currency,periodStart:date(o.period_start??event.created),periodEnd:date(o.period_end??(event.created+30*86400)),occurredAt:date(event.created),testMode:true})});
});
