import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ensureWorkflowStep } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { recoverPaidBookingPayments } from './booking-payment-recovery.js';
const mocks = vi.hoisted(() => ({ late: vi.fn(), confirmed: vi.fn() }));
vi.mock('./booking-late-payment.js', () => ({ reconcileLateBookingPayment: mocks.late }));
vi.mock('./booking-confirmed-effects.js', async original => ({
  ...await original<typeof import('./booking-confirmed-effects.js')>(), runConfirmedBookingSideEffects: mocks.confirmed,
}));
let f: SqliteD1;
const now = new Date('2026-10-18T01:00:00Z');
beforeEach(() => {
  vi.clearAllMocks();
  f = createTestD1({ foreignKeys: true });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external_forbidden'); }));
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','A','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a');
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','S','S');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','M',60,1000);`);
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });
function payment(id: string, status: string) {
  f.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES(?,'a','f','s','m','2030-01-01T03:00:00Z','2030-01-01T04:00:00Z','2030-01-01T04:00:00Z',?,1000,'2026-10-18')`).run(id, status);
  f.raw.prepare(`INSERT INTO booking_payments(id,line_account_id,booking_id,amount,status,provider,provider_payment_id,idempotency_key,created_at,updated_at)
    VALUES(?,'a',?,1000,'paid','stripe','pi_test_fixture',?,'2026-10-18','2026-10-18')`).run(id,id,id);
}
test('200件の終了済み・待機中の補償があっても、後続の入金を回収する', async () => {
  const states = ['exhausted','succeeded','unknown','canceled','failed','running'];
  for (let i=0;i<200;i++) {
    const id = `a${String(i).padStart(3,'0')}`;
    payment(id, 'cancelled');
    await ensureWorkflowStep(f.db,{scopeId:'line:a',processKind:'booking_late_payment',subjectId:id,stepKey:'resolve'},{now:now.getTime(),maxAttempts:3});
    const state = states[i % states.length];
    f.raw.prepare(`UPDATE workflow_steps SET status=?,next_attempt_at=?,lease_owner=?,lease_expires_at=? WHERE subject_id=?`)
      .run(state,now.getTime()+3600000,state==='running'?'fixture':null,state==='running'?now.getTime()+3600000:null,id);
  }
  payment('z-requested','requested'); payment('z-late','cancelled');
  await recoverPaidBookingPayments(f.db,now);
  expect(f.raw.prepare("SELECT status FROM bookings WHERE id='z-requested'").get()).toEqual({status:'confirmed'});
  expect(mocks.late.mock.calls.map(c=>c[1])).toEqual(['z-requested','z-late']);
  expect(fetch).not.toHaveBeenCalled();
});
test('補償に処理待ちが200件あっても確定可能な申込を先に回収する', async () => {
  for(let i=0;i<200;i++)payment(`a${String(i).padStart(3,'0')}`,'cancelled');
  payment('z-requested','requested');
  await recoverPaidBookingPayments(f.db,now);
  expect(f.raw.prepare("SELECT status FROM bookings WHERE id='z-requested'").get()).toEqual({status:'confirmed'});
  expect(mocks.late).toHaveBeenCalledTimes(200);
  expect(mocks.late.mock.calls[0][1]).toBe('z-requested');
});
