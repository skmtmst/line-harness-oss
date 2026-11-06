import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { reconcileLateBookingPayment } from './booking-late-payment.js';
const mocks=vi.hoisted(()=>({busy:vi.fn(),notify:vi.fn()}));
vi.mock('./booking-calendar-sync.js',async original=>({...await original<typeof import('./booking-calendar-sync.js')>(),getStaffGoogleBusy:mocks.busy}));
vi.mock('./booking-notification.js',async original=>({...await original<typeof import('./booking-notification.js')>(),notifyForBooking:mocks.notify}));
vi.mock('../../services/availability.js',async original=>({...await original<typeof import('../../services/availability.js')>(),getAvailability:async()=>({by_staff:[{staff_id:'s',slots:[{startUtc:'2030-01-01T03:00:00Z'}]}],closed_dates:[]})}));
let f:SqliteD1;
const now=new Date('2026-10-18T01:00:00Z');
beforeEach(()=>{
  vi.clearAllMocks();mocks.busy.mockResolvedValue(null);mocks.notify.mockResolvedValue(undefined);
  f=createTestD1({foreignKeys:true});f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','S','S');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','M',60,1000),('other','a','Other',60,1000);
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES('b','a','f','s','m','2030-01-01T03:00:00Z','2030-01-01T04:00:00Z','2030-01-01T04:00:00Z','expired',1000,'2026-10-18');
    INSERT INTO booking_payments(id,line_account_id,booking_id,amount,status,provider,provider_payment_id,idempotency_key,created_at,updated_at)
      VALUES('p','a','b',1000,'paid','stripe','pi_test_late','payment-key','2026-10-18','2026-10-18');`);
});
afterEach(()=>f.raw.close());
const booking=()=>f.raw.prepare('SELECT status,lock_version FROM bookings WHERE id=\'b\'').get();
const payment=()=>f.raw.prepare('SELECT status,refunded_amount FROM booking_payments WHERE id=\'p\'').get();
it('空いた枠は並行でも一度だけ復元し、入金・履歴・通知と要対応を残す',async()=>{
  await Promise.all([reconcileLateBookingPayment(f.db,'p',now),reconcileLateBookingPayment(f.db,'p',now)]);
  await reconcileLateBookingPayment(f.db,'p',new Date(now.getTime()+600000));
  expect(booking()).toEqual({status:'confirmed',lock_version:1});expect(payment()).toEqual({status:'paid',refunded_amount:0});
  expect(f.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='payment_hold_restored'").get()).toEqual({n:1});
  expect(mocks.notify).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare("SELECT error_code FROM booking_operation_runs WHERE kind='automation'").get()).toEqual({error_code:'late_payment_review_required'});
});
it('空き確認後に埋まってもCASで復元せず、一度だけ全額を模擬返金する',async()=>{
  f.raw.exec(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES('other','a','f','s','other','2030-01-01T03:00:00Z','2030-01-01T04:00:00Z','2030-01-01T04:00:00Z','confirmed',1000,'2026-10-18');`);
  await reconcileLateBookingPayment(f.db,'p',now);await reconcileLateBookingPayment(f.db,'p',new Date(now.getTime()+600000));
  expect(booking()).toEqual({status:'expired',lock_version:0});expect(payment()).toEqual({status:'refunded',refunded_amount:1000});
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').get()).toEqual({n:1});expect(mocks.notify).not.toHaveBeenCalled();
  expect(f.raw.prepare("SELECT result_json FROM booking_operation_runs WHERE kind='confirmation_line'").get()).toEqual({result_json:'{"reason":"late_payment_refund","simulation":true,"sent":false}'});
});
it('Googleの読取り不能では返金・復元を推測せず、要対応を残す',async()=>{
  mocks.busy.mockRejectedValue(new Error('provider secret payload'));
  await reconcileLateBookingPayment(f.db,'p',now);
  expect(booking()).toEqual({status:'expired',lock_version:0});expect(payment()).toEqual({status:'paid',refunded_amount:0});
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').get()).toEqual({n:0});expect(mocks.notify).not.toHaveBeenCalled();
  expect(JSON.stringify(f.raw.prepare('SELECT * FROM workflow_steps').all())).not.toContain('provider secret');
});
it('補償の保存失敗は全額と履歴を戻し、同じ補償キーで再開する',async()=>{
  f.raw.exec("UPDATE bookings SET status='cancelled'; CREATE TRIGGER crash_refund BEFORE UPDATE OF refunded_amount ON booking_payments BEGIN SELECT RAISE(ABORT,'fixture'); END");
  await reconcileLateBookingPayment(f.db,'p',now);expect(payment()).toEqual({status:'paid',refunded_amount:0});
  expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').get()).toEqual({n:0});
  f.raw.exec('DROP TRIGGER crash_refund');await reconcileLateBookingPayment(f.db,'p',new Date(now.getTime()+60000));
  expect(payment()).toEqual({status:'refunded',refunded_amount:1000});expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').get()).toEqual({n:1});
});
it('本当の返金口が無い支払は代用で送金せず要対応に残す',async()=>{
  f.raw.exec("UPDATE bookings SET status='cancelled'; UPDATE booking_payments SET provider_payment_id='pi_real_fixture'");
  await reconcileLateBookingPayment(f.db,'p',now);
  expect(payment()).toEqual({status:'paid',refunded_amount:0});expect(f.raw.prepare('SELECT COUNT(*) n FROM booking_payment_refunds').get()).toEqual({n:0});
});
