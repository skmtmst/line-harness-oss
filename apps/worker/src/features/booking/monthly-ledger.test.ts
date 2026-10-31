import { afterEach, describe, expect, it } from 'vitest';
import { findMonthlyContractReplay, listMonthlyContracts, monthlyEntitlementAccess, recordMonthlyEventApplication, setMonthlyServiceState } from '@line-crm/db';
import { monthlyFixture, monthlyContract, monthlySnapshot, monthlyCycle, monthlyRight, activateMonthly, monthlyUse, monthlyNow, monthlyScope } from '../../test-utils/monthly-ledger.js';
import type { SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { expirePassGrace } from './booking-pass-billing.js';
import { passUnusable } from './booking-pass-plans.js';
import { validateEventEntitlement } from '../../services/event-entitlements.js';
import { entitlementViews } from './booking-entitlements/index.js';

const opened: SqliteD1[] = [];
function fixture() { const d = monthlyFixture(); opened.push(d); return d; }
afterEach(() => { for (const d of opened.splice(0)) d.raw.close(); });
async function paid(kind: 'menu' | 'event' = 'menu') {
  const d = fixture();
  await monthlyContract(d, kind === 'event' ? { classKind: 'event', classId: 'class' } : {});
  monthlyCycle(d, { paid: true }); activateMonthly(d); monthlyRight(d, kind);
  return d;
}
describe('月謝の実DB台帳', () => {
  it('同じ本人・教室は別キーでも1契約、別の本人は独立する', async () => {
    const d = fixture(); await monthlyContract(d);
    await expect(monthlyContract(d, { id: 'other' }, 'other-key')).rejects.toThrow(/UNIQUE/);
    await monthlyContract(d, { id: 'other-friend', friendId: 'f2' }, 'other-key');
    expect(d.raw.prepare('SELECT count(*) n FROM booking_monthly_active_slots').get()).toEqual({ n: 2 });
  });
  it('同じ要求は生成IDが違っても元の契約、異なる金額は競合', async () => {
    const d = fixture(); await monthlyContract(d);
    expect((await findMonthlyContractReplay(d.db, monthlyScope, 'f', 'apply-key', monthlySnapshot({ id: 'new-generated-id' })))?.id).toBe('contract');
    await expect(findMonthlyContractReplay(d.db, monthlyScope, 'f', 'apply-key', monthlySnapshot({ amount: 7000 }))).rejects.toThrow('monthly_idempotency_conflict');
  });
  it.each([{ friendId: 'missing' }, { amount: 6001 }, { planVersion: 2 }, { classId: 'elsewhere' }, { classKind: 'event' as const, classId: 'menu' }])('不正な固定条件を拒否する %j', async input => {
    const d = fixture(); await expect(monthlyContract(d, input)).rejects.toThrow();
    expect(d.raw.prepare('SELECT count(*) n FROM booking_monthly_contracts').get()).toEqual({ n: 0 });
  });
  it('他店の本人・NULLテナント・別テナントの組を受け付けない', async () => {
    const d = fixture();
    d.raw.exec("UPDATE friends SET line_account_id='b' WHERE id='f'");
    await expect(monthlyContract(d)).rejects.toThrow();
    d.raw.exec("UPDATE friends SET line_account_id='a' WHERE id='f'; UPDATE line_accounts SET tenant_id=NULL WHERE id='a'");
    await expect(monthlyContract(d)).rejects.toThrow();
  });
  it('期待版・固定接続先を守り、権利のある本人を連鎖削除しない', async () => {
    const d = await paid();
    expect(() => d.raw.exec("UPDATE booking_monthly_contracts SET connected_account='acct_changed',version=version+1")).toThrow('monthly_contract_conflict');
    await expect(setMonthlyServiceState(d.db, monthlyScope, 'contract', 1, 'review_hold', null, '支払を確認中', monthlyNow)).rejects.toThrow('monthly_version_conflict');
    expect(() => d.raw.exec("DELETE FROM friends WHERE id='f'")).toThrow();
  });
  it('期限切れ申込は枠を解放でき、終了した契約は再度有効化できない', async () => {
    const d = fixture(); await monthlyContract(d);
    d.raw.exec("UPDATE booking_monthly_contracts SET state='expired',version=version+1; DELETE FROM booking_monthly_active_slots");
    await monthlyContract(d, { id: 'replacement' }, 'replacement');
    expect(() => d.raw.exec("UPDATE booking_monthly_contracts SET state='active',version=version+1 WHERE id='contract'")).toThrow('monthly_contract_conflict');
  });
  it('月1件・初回1件・同じ接続先のinvoice1件、入金済みを古い失敗へ戻さない', async () => {
    const d = await paid();
    expect(() => monthlyCycle(d, { id: 'duplicate' })).toThrow(/UNIQUE/);
    expect(() => monthlyCycle(d, { id: 'second-initial', month: '2026-10' })).toThrow(/UNIQUE/);
    await monthlyContract(d, { id: 'another', friendId: 'f2' }, 'another');
    expect(() => d.raw.exec(`INSERT INTO booking_monthly_cycles(id,contract_id,tenant_id,account_id,connected_account,month_key,kind,due_at,period_start,service_start,service_end,amount,invoice_id,invoice_status,auto_advance,state,paid_at,created_at,updated_at)
      SELECT 'other-cycle','another',tenant_id,account_id,connected_account,month_key,kind,due_at,period_start,service_start,service_end,amount,invoice_id,invoice_status,auto_advance,state,paid_at,created_at,updated_at FROM booking_monthly_cycles WHERE id='cycle'`)).toThrow(/UNIQUE/);
    expect(() => d.raw.exec("UPDATE booking_monthly_cycles SET state='retry_wait',version=version+1")).toThrow('monthly_cycle_conflict');
    expect(() => d.raw.exec("UPDATE booking_monthly_cycles SET invoice_id='in_changed',version=version+1")).toThrow('monthly_cycle_conflict');
    expect(() => d.raw.exec('DELETE FROM booking_monthly_cycles')).toThrow('monthly_cycle_immutable');
    expect(() => d.raw.exec('UPDATE booking_monthly_cycles SET auto_advance=1,version=version+1')).toThrow();
  });
  it('初回未入金の権利は作れず、対象月と初回を後から偽装できない', async () => {
    const d = fixture(); await monthlyContract(d); monthlyCycle(d);
    expect(() => monthlyRight(d, 'menu', 'provisional')).toThrow('monthly_right_unavailable');
    d.raw.exec("DELETE FROM booking_entitlements WHERE id='grant'");
    monthlyCycle(d, { id: 'previous', month: '2026-10', kind: 'renewal', paid: true });
    d.raw.exec("UPDATE booking_monthly_cycles SET kind=kind,version=version+1 WHERE id='cycle'");
    // 同じ対象月の初回を更新に偽装しない。更新権利は別の契約で検証する。
    expect(() => d.raw.exec("UPDATE booking_monthly_cycles SET kind='renewal',version=version+1 WHERE id='cycle'")).toThrow('monthly_cycle_conflict');
  });
  it('更新は前月のpaidを持つ時だけprovisionalを作り、最終失敗で利用不可', async () => {
    const d = fixture(); await monthlyContract(d);
    monthlyCycle(d, { id: 'initial', month: '2026-10', paid: true }); activateMonthly(d);
    monthlyCycle(d, { kind: 'renewal' }); monthlyRight(d, 'menu', 'provisional');
    expect(await monthlyEntitlementAccess(d.db, 'a', 'grant', 'menu', 'menu', '2026-11-20T05:00:00Z')).toEqual({ reason: null });
    d.raw.exec("UPDATE booking_monthly_cycles SET state='exhausted',version=version+1 WHERE id='cycle'");
    expect(await monthlyEntitlementAccess(d.db, 'a', 'grant', 'menu', 'menu', '2026-11-20T05:00:00Z')).toEqual({ reason: 'billing_stopped' });
    expect(() => d.raw.exec("DELETE FROM booking_monthly_active_slots")).toThrow('monthly_slot_unresolved');
  });
  it('Webhook適用の重複は1件、本文違い・別接続先を拒む', async () => {
    const d = await paid();
    const event = { source: 'connect', connectedAccount: 'acct_original', eventId: 'evt_paid', receiptId: 'receipt-1', payloadDigest: 'a'.repeat(64), contractId: 'contract', cycleId: 'cycle', outcome: 'paid' as const };
    const effect = d.db.prepare("UPDATE booking_monthly_cycles SET version=version+1 WHERE id='cycle'");
    expect(await recordMonthlyEventApplication(d.db, monthlyScope, event, monthlyNow, [effect])).toEqual({ replayed: false });
    expect(await recordMonthlyEventApplication(d.db, monthlyScope, event, monthlyNow, [effect])).toEqual({ replayed: true });
    expect(d.raw.prepare("SELECT version FROM booking_monthly_cycles WHERE id='cycle'").get()).toEqual({ version: 2 });
    expect(d.raw.prepare('SELECT count(*) n FROM booking_monthly_event_applications').get()).toEqual({ n: 1 });
    await expect(recordMonthlyEventApplication(d.db, monthlyScope, { ...event, payloadDigest: 'b'.repeat(64) }, monthlyNow)).rejects.toThrow('monthly_event_conflict');
    await expect(recordMonthlyEventApplication(d.db, monthlyScope, { ...event, connectedAccount: 'acct_other', eventId: 'evt_other', receiptId: 'receipt-2' }, monthlyNow)).rejects.toThrow();
  });
  it('反映途中の障害では受信の適用も巻き戻り、同じイベントで再開できる', async () => {
    const d = await paid();
    const event = { source: 'connect', connectedAccount: 'acct_original', eventId: 'evt_paid', receiptId: 'receipt-1', payloadDigest: 'a'.repeat(64), contractId: 'contract', cycleId: 'cycle', outcome: 'paid' as const };
    await expect(recordMonthlyEventApplication(d.db, monthlyScope, event, monthlyNow, [d.db.prepare("UPDATE booking_monthly_cycles SET amount=1,version=version+1 WHERE id='cycle'")])).rejects.toThrow();
    expect(d.raw.prepare('SELECT count(*) n FROM booking_monthly_event_applications').get()).toEqual({ n: 0 });
    expect(await recordMonthlyEventApplication(d.db, monthlyScope, event, monthlyNow)).toEqual({ replayed: false });
    await expect(recordMonthlyEventApplication(d.db, monthlyScope, { ...event, eventId: 'another' }, monthlyNow)).rejects.toThrow('monthly_event_conflict');
  });
  it('結果不明は次試行を止め、失敗後だけ3/5/7日の試行を作る', async () => {
    const d = await paid();
    monthlyCycle(d, { id: 'renewal', month: '2026-10', kind: 'renewal' });
    const insert = d.raw.prepare(`INSERT INTO booking_monthly_attempts(cycle_id,tenant_id,account_id,attempt_no,scheduled_at,payment_method_id,payment_method_version,request_key,state)
      VALUES('renewal','t','a',?,?,'pm_original',1,?,?)`);
    insert.run(0, monthlyNow, 'attempt0', 'unknown');
    expect(() => insert.run(1, '2026-11-13T00:00:00.000Z', 'attempt1', 'pending')).toThrow();
    d.raw.exec("UPDATE booking_monthly_attempts SET state='failed',version=version+1; UPDATE booking_monthly_cycles SET first_failed_at='2026-11-10T00:00:00.000Z',version=version+1 WHERE id='renewal'");
    expect(() => insert.run(1, '2026-11-12T00:00:00.000Z', 'wrong-time', 'pending')).toThrow();
    for (const [no, day] of [[1, 13], [2, 15], [3, 17]]) insert.run(no, `2026-11-${day}T00:00:00.000Z`, `attempt${no}`, 'failed');
    expect(() => insert.run(4, '2026-11-19T00:00:00.000Z', 'attempt4', 'failed')).toThrow();
    expect(() => d.raw.exec("UPDATE booking_monthly_attempts SET payment_method_id='pm_changed',version=version+1 WHERE attempt_no=0")).toThrow('monthly_attempt_conflict');
  });
  it.each(['menu', 'event'] as const)('%s：消化は保留で止め、既存日時の変更は同じ月と教室で許す', async kind => {
    const d = await paid(kind);
    d.raw.exec("UPDATE booking_entitlements SET billing_status='grace',grace_until='2026-11-01T00:00:00Z'");
    await expirePassGrace(d.db, new Date(monthlyNow));
    expect(d.raw.prepare("SELECT billing_status FROM booking_entitlements WHERE id='grant'").get()).toEqual({ billing_status: 'grace' });
    d.raw.exec("UPDATE booking_pass_plans SET target_scope_json='[\"other-menu\"]',event_target_scope_json=NULL");
    if (kind === 'event') await expect(validateEventEntitlement(d.db, 'a', 'f', 'class', 'grant', '2026-11-20T05:00:00Z')).resolves.toMatchObject({ id: 'grant' });
    else {
      const grant = (await entitlementViews(d.db, 'a', 'f', '2026-11-20T05:00:00Z'))[0];
      expect(await passUnusable(d.db, grant, 'a', 'menu', '2026-11-20T05:00:00Z')).toBeNull();
    }
    monthlyUse(d, kind);
    await setMonthlyServiceState(d.db, monthlyScope, 'contract', 2, 'review_hold', { id: 'episode', startedAt: monthlyNow }, '支払を確認中', monthlyNow);
    expect(await monthlyEntitlementAccess(d.db, 'a', 'grant', kind, kind === 'menu' ? 'menu' : 'class', '2026-11-20T05:00:00Z')).toEqual({ reason: 'billing_stopped' });
    const table = kind === 'menu' ? 'bookings' : 'event_bookings';
    expect(() => d.raw.exec(`UPDATE ${table} SET status='confirmed'`)).toThrow('entitlement_unavailable');
    expect(() => d.raw.exec(kind === 'menu' ? "UPDATE bookings SET starts_at='2026-11-21T05:00:00Z' WHERE id='bk'" : "UPDATE event_slots SET starts_at='2026-11-21T05:00:00Z' WHERE id='slot'")).not.toThrow();
    expect(() => d.raw.exec(kind === 'menu' ? "UPDATE bookings SET starts_at='2026-12-02T05:00:00Z' WHERE id='bk'" : "UPDATE event_slots SET starts_at='2026-12-02T05:00:00Z' WHERE id='slot'")).toThrow();
  });
  it.each(['menu', 'event'] as const)('%s：保留のない確定は1回消化し、繰り返しても増えない', async kind => {
    const d = await paid(kind); monthlyUse(d, kind);
    const table = kind === 'menu' ? 'bookings' : 'event_bookings';
    d.raw.exec(`UPDATE ${table} SET status='confirmed'`);
    d.raw.exec(`UPDATE ${table} SET status='confirmed'`);
    expect((await entitlementViews(d.db, 'a', 'f', '2026-11-20T05:00:00Z'))[0].monthUsed).toBe(1);
  });
  it('本人の停止を未払いの停止で上書きせず、遅いpaidでも解除しない', async () => {
    const d = await paid();
    d.raw.exec("UPDATE booking_monthly_contracts SET state='stop_scheduled',stop_reason='member_request',stop_effective_at='2026-11-30T15:00:00Z',version=version+1");
    expect(() => d.raw.exec("UPDATE booking_monthly_contracts SET state='stopped',stop_reason='unpaid',version=version+1")).toThrow('monthly_contract_conflict');
    d.raw.exec("UPDATE booking_monthly_contracts SET state='stopped',version=version+1");
    expect(() => d.raw.exec("UPDATE booking_monthly_contracts SET state='active',stop_reason=NULL,stop_effective_at=NULL,version=version+1")).toThrow('monthly_contract_conflict');
  });
  it('当月paidは同じ枠の未払い停止だけ戻し、枠解放後や過去月paidから復活しない', async () => {
    const d = await paid();
    const stop = "UPDATE booking_monthly_contracts SET state='stopped',stop_reason='unpaid',stop_effective_at='2026-11-09T00:00:00Z',version=version+1";
    const restore = "UPDATE booking_monthly_contracts SET state='active',stop_reason=NULL,stop_effective_at=NULL,version=version+1";
    d.raw.exec(stop); expect(() => d.raw.exec(restore)).not.toThrow();
    d.raw.exec(stop);
    d.raw.exec("UPDATE booking_monthly_rights SET state='revoked',version=version+1; DELETE FROM booking_monthly_active_slots");
    expect(() => d.raw.exec(restore)).toThrow('monthly_contract_conflict');
    const previous = fixture(); await monthlyContract(previous);
    monthlyCycle(previous, { month: '2026-10', paid: true }); activateMonthly(previous);
    previous.raw.exec(stop);
    expect(() => previous.raw.exec(restore)).toThrow('monthly_contract_conflict');
  });
  it('翌月停止の効力後を対象にした新規予約と消化は許可しない', async () => {
    const d = await paid();
    d.raw.exec("UPDATE booking_monthly_contracts SET state='stop_scheduled',stop_reason='member_request',stop_effective_at='2026-11-15T00:00:00Z',version=version+1");
    expect(() => monthlyUse(d)).toThrow('entitlement_unavailable');
  });
  it('長期unknownの時計はリセット不可、7日を過ぎた利用をviewでも止める', async () => {
    const d = await paid();
    d.raw.exec("UPDATE booking_monthly_contracts SET attention_episode_id='episode',attention_started_at='2026-11-01T00:00:00Z',version=version+1");
    expect(d.raw.prepare('SELECT * FROM booking_monthly_available_rights').all()).toEqual([]);
    expect(() => d.raw.exec("UPDATE booking_monthly_contracts SET attention_started_at='2026-11-09T00:00:00Z',version=version+1")).toThrow('monthly_contract_conflict');
  });
  it('無制限の月謝と固定した月境界は、店のtimezone変更後も保つ', async () => {
    const d = fixture();
    d.raw.exec('UPDATE booking_pass_plans SET monthly_limit=NULL');
    await monthlyContract(d, { monthlyLimit: null }); monthlyCycle(d, { paid: true }); activateMonthly(d); monthlyRight(d);
    d.raw.exec("UPDATE booking_settings SET timezone='America/Los_Angeles'");
    const grant = (await entitlementViews(d.db, 'a', 'f', '2026-11-30T16:00:00Z'))[0];
    expect(grant.monthRemaining).toBeNull();
    expect(Date.parse(grant.periodStart)).toBe(Date.parse('2026-10-31T15:00:00Z'));
    expect(Date.parse(grant.periodEnd)).toBe(Date.parse('2026-11-30T15:00:00Z'));
    expect(await monthlyEntitlementAccess(d.db, 'a', 'grant', 'menu', 'menu', '2026-11-30T16:00:00Z')).toEqual({ reason: 'expired' });
  });
  it('読み取りDTOにカード・接続先・同意本文・Webhook本文を出さない', async () => {
    const d = await paid();
    const result = await listMonthlyContracts(d.db, monthlyScope, 'f');
    expect(result.total).toBe(1); expect(result.items[0].cycles).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/acct_|pm_|cus_|in_cycle|request_json|consent/);
    expect(await listMonthlyContracts(d.db, { tenantId: 'other', accountId: 'b' }, 'f')).toEqual({ items: [], total: 0 });
  });
});
