import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gapApp, gapFixture } from '../test-utils/gap1.js';
import { bookingCancellation } from './booking-cancellation.js';
import { bookingPassBilling } from './booking-pass-billing.js';
import { bookingPayments } from './booking-payments.js';
const paths=['/api/liff/booking/setup-webhook','/api/booking/pass-payments/webhook','/api/booking/payments/webhook/stripe'];
let f:ReturnType<typeof gapFixture>;
function sample(path:string){
  const object=path.endsWith('setup-webhook') ? {id:'seti_mock',status:'succeeded',customer:'cus_mock',payment_method:'pm_mock'}
    : path.includes('pass-payments') ? {id:'cs_mock',payment_status:'paid',amount_total:3000,currency:'jpy'}
    : {id:'pi_mock',amount:1000,currency:'jpy'};
  const type=path.endsWith('setup-webhook') ? 'setup_intent.succeeded' : path.includes('pass-payments') ? 'checkout.session.completed' : 'payment_intent.succeeded';
  return {id:'evt_mock',created:Math.floor(Date.now()/1000),type,livemode:false,data:{object:{...object,livemode:false}}};
}
const rejection=(path:string)=>path.endsWith('/stripe')?401:409;
beforeEach(()=>{f=gapFixture();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();f.raw.close();vi.unstubAllGlobals();});
function send(path:string,body:string){
  const t=Math.floor(Date.now()/1000),sig=createHmac('sha256','test-webhook-secret').update(`${t}.${body}`).digest('hex');
  return gapApp(f,[bookingCancellation,bookingPassBilling,bookingPayments]).request(path,{method:'POST',body,headers:{'stripe-signature':`t=${t},v1=${sig}`}});
}
it.each(paths)('模擬口ではConnectの通知を業務へ入れない %s',async path=>{
  const body=JSON.stringify({...sample(path),account:'acct_real'});
  expect((await send(path,body)).status).toBe(rejection(path));
  expect(f.raw.prepare('SELECT count(*) n FROM booking_payment_methods').get()).toEqual({n:0});
  expect(f.raw.prepare('SELECT count(*) n FROM booking_payment_events').get()).toEqual({n:0});
  expect(f.raw.prepare('SELECT count(*) n FROM booking_entitlements').get()).toEqual({n:0});
});
it.each(paths)('模擬口でもモードの欠落やliveを拒む %s',async path=>{
  for(const [outer,inner] of [[false,undefined],[undefined,false],[false,true],[true,false]]){
    const e=sample(path),body=JSON.stringify({...e,livemode:outer,data:{object:{...e.data.object,livemode:inner}}});
    expect((await send(path,body)).status).toBe(rejection(path));
  }
});
it.each(paths)('模擬口の本文上限は署名より先に検査する %s',async path=>{
  expect((await send(path,'x'.repeat(256*1024+1))).status).toBe(413);
});
