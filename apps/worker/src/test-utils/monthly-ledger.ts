import { gapFixture, seedGapBooking } from './gap1.js';
import { useSqliteClock } from './sqlite-clock.js';
import type { SqliteD1 } from './d1-sqlite.js';
import { prepareMonthlyContract, type MonthlyContractSnapshot } from '@line-crm/db';

export const monthlyNow = '2026-11-10T00:00:00.000Z';
export const monthlyScope = { tenantId: 't', accountId: 'a' };
export function monthlyFixture() {
  const d = gapFixture();
  useSqliteClock(d.raw, () => new Date(monthlyNow));
  d.raw.pragma('foreign_keys=ON');
  d.raw.exec(`INSERT INTO events(id,line_account_id,name,is_published,lifecycle_status) VALUES('class','a','教室',1,'published');
    INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity) VALUES('slot','class','2026-11-20T05:00:00Z','2026-11-20T06:00:00Z',20);
    INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,monthly_limit,valid_days,target_scope_json,event_target_scope_json,status,created_by,created_at,idempotency_key,request_json)
    VALUES('plan','a','monthly','月謝',6000,NULL,4,30,'["menu"]','["class"]','on_sale','o','2026-10-01T00:00:00Z','plan-key','{}');`);
  return d;
}
export function monthlySnapshot(overrides: Partial<MonthlyContractSnapshot> = {}): MonthlyContractSnapshot {
  return { id: 'contract', friendId: 'f', planId: 'plan', planVersion: 1, name: '月謝', classKind: 'menu', classId: 'menu',
    amount: 6000, monthlyLimit: 4, timezone: 'Asia/Tokyo', consentVersion: 'terms-1', consentedAt: monthlyNow,
    connectedAccount: 'acct_original', connectionIdentity: 'connection-1', ...overrides };
}
export async function monthlyContract(d: SqliteD1, overrides: Partial<MonthlyContractSnapshot> = {}, key = 'apply-key') {
  await prepareMonthlyContract(d.db, monthlyScope, monthlySnapshot(overrides), key, monthlyNow).run();
}
export function monthlyCycle(d: SqliteD1, options: { id?: string; contract?: string; month?: string; kind?: string; paid?: boolean } = {}) {
  const id = options.id ?? 'cycle', contract = options.contract ?? 'contract', month = options.month ?? '2026-11';
  const start = month === '2026-10' ? '2026-09-30T15:00:00.000Z' : '2026-10-31T15:00:00.000Z';
  const end = month === '2026-10' ? '2026-10-31T15:00:00.000Z' : '2026-11-30T15:00:00.000Z';
  d.raw.prepare(`INSERT INTO booking_monthly_cycles(id,contract_id,tenant_id,account_id,connected_account,month_key,kind,due_at,period_start,service_start,service_end,amount,invoice_id,invoice_status,auto_advance,state,paid_at,created_at,updated_at)
    VALUES(?,?,'t','a','acct_original',?,?,?,?,?,?,6000,?,?,0,?,?,?,?)`)
    .run(id, contract, month, options.kind ?? 'initial', start, start, start, end, `in_${id}`, options.paid ? 'paid' : 'open', options.paid ? 'paid' : 'open', options.paid ? monthlyNow : null, monthlyNow, monthlyNow);
}
export function monthlyRight(d: SqliteD1, kind: 'menu' | 'event' = 'menu', state = 'paid', cycle = 'cycle', entitlement = 'grant') {
  d.raw.prepare(`INSERT INTO booking_entitlements(id,line_account_id,friend_id,menu_id,kind,name,monthly_limit,valid_from,expires_at,created_at,updated_at,plan_id,source)
    SELECT ?,'a','f',?,'monthly','月謝',(SELECT monthly_limit FROM booking_monthly_contracts WHERE id=contract_id),service_start,service_end,?,?,'plan','online' FROM booking_monthly_cycles WHERE id=?`)
    .run(entitlement, kind === 'menu' ? 'menu' : null, monthlyNow, monthlyNow, cycle);
  d.raw.prepare(`INSERT INTO booking_monthly_rights(contract_id,cycle_id,tenant_id,account_id,month_key,entitlement_id,state,updated_at)
    SELECT contract_id,id,tenant_id,account_id,month_key,?,?,? FROM booking_monthly_cycles WHERE id=?`).run(entitlement, state, monthlyNow, cycle);
}
export function activateMonthly(d: SqliteD1) {
  d.raw.exec(`UPDATE booking_monthly_contracts SET state='active',customer_id='cus_original',payment_method_id='pm_original',payment_method_version=1,version=version+1 WHERE id='contract'`);
}
export function monthlyUse(d: SqliteD1, kind: 'menu' | 'event' = 'menu') {
  if (kind === 'menu') {
    seedGapBooking(d, 'bk', 'requested');
    return d.raw.prepare(`INSERT INTO booking_entitlement_uses(booking_id,booking_id_history,entitlement_id,period_start,period_end)
      VALUES('bk','bk','grant','2026-10-31T15:00:00.000Z','2026-11-30T15:00:00.000Z')`).run();
  }
  d.raw.exec(`INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at) VALUES('eb','a','class','slot','f','requested','2026-11-10T00:00:00Z')`);
  return d.raw.prepare(`INSERT INTO event_booking_entitlement_uses(event_booking_id,event_booking_id_history,line_account_id,event_id,slot_id,starts_at,entitlement_id,period_start,period_end,operation_key,created_at,updated_at)
    VALUES('eb','eb','a','class','slot','2026-11-20T05:00:00Z','grant','2026-10-31T15:00:00.000Z','2026-11-30T15:00:00.000Z','event-use:eb',?,?)`).run(monthlyNow, monthlyNow);
}
