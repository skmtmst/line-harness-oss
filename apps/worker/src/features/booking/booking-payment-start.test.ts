import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { createBookingPayment, type BookingPaymentRecord } from '@line-crm/db';

import { runBookingPaymentStart } from './booking-payment-start.js';
import type { PaymentProvider } from '../../services/payment-providers.js';
let f:SqliteD1;
beforeEach(()=>{
  f=createTestD1({foreignKeys:true});f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','S','S');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','M',60,1000);
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES('b','a','f','s','m','2030-01-01T03:00:00Z','2030-01-01T04:00:00Z','2030-01-01T04:00:00Z','requested',1000,'2026-10-18');`);
});
afterEach(()=>f.raw.close());
const create=(key:string)=>createBookingPayment(f.db,{lineAccountId:'a',bookingId:'b',amount:1000,provider:'stripe',idempotencyKey:key,
  holdUntil:new Date(Date.now()+600000).toISOString()});
function provider():PaymentProvider {
  return {name:'stripe',startPayment:vi.fn(async()=>({checkoutUrl:'https://checkout.stripe.com/test/fixture',providerPaymentId:'pi_test_fixture'})),
    getStatus:async()=> 'unknown',refund:async()=>false,verifyWebhook:async()=>null};
}
it('別のキーで同時に始めても支払記録は1行、外部開始は1回',async()=>{
  const [a,b]=await Promise.all([create('one'),create('two')]);expect(a.id).toBe(b.id);
  const external=provider();const outcomes=await Promise.all([runBookingPaymentStart(f.db,a,external),runBookingPaymentStart(f.db,b,external)]);
  expect(outcomes.map(r=>r.kind)).toContain('success');expect(external.startPayment).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare('SELECT status,provider_payment_id FROM booking_payments').get()).toEqual({status:'pending',provider_payment_id:'pi_test_fixture'});
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payments').get()).toEqual({n:1});
});
it('受理後の結果保存失敗は新しい支払キーでも再課金しない',async()=>{
  const a=await create('one'),external=provider();
  f.raw.exec("CREATE TRIGGER crash_payment BEFORE UPDATE ON booking_payments BEGIN SELECT RAISE(ABORT,'fixture'); END");
  expect((await runBookingPaymentStart(f.db,a,external)).kind).toBe('unknown');
  f.raw.exec('DROP TRIGGER crash_payment');const b=await create('two');
  expect((await runBookingPaymentStart(f.db,b,external)).kind).toBe('unknown');
  expect(external.startPayment).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare('SELECT status FROM booking_payments').get()).toEqual({status:'unpaid'});
});
it('取消・別店・期限切れは外部開始0',async()=>{
  const a=await create('one'),external=provider();f.raw.exec("UPDATE bookings SET status='cancelled'");
  expect((await runBookingPaymentStart(f.db,a,external)).kind).toBe('stopped');expect(external.startPayment).not.toHaveBeenCalled();
  await expect(runBookingPaymentStart(f.db,{...a,line_account_id:'other'} as BookingPaymentRecord,external)).resolves.toMatchObject({kind:'stopped'});
  expect(external.startPayment).not.toHaveBeenCalled();
});
