import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { reconcilePaidBookingPayment, recoverPaidBookingPayments, recoverOrphanedOnlineBookings } from './booking-payment-recovery.js';
import { recoverConfirmedBookingSideEffects, runConfirmedBookingSideEffects } from './booking-confirmed-effects.js';
const effects = vi.hoisted(() => ({ send: vi.fn(), google: vi.fn(), automation: vi.fn() }));
vi.mock('./booking-notifier.js', async original => ({
  ...await original<typeof import('./booking-notifier.js')>(), sendBookingNotification: effects.send,
}));
vi.mock('./booking-calendar-sync.js', async original => ({
  ...await original<typeof import('./booking-calendar-sync.js')>(), syncConfirmedBookingToGoogle: effects.google,
}));
vi.mock('./automation-triggers.js', async original => ({
  ...await original<typeof import('./automation-triggers.js')>(), dispatchAutomationEventWithLogging: effects.automation,
}));
let sql: SqliteD1;
const now = new Date('2026-10-12T00:00:00Z');
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('外部通信禁止'); }));
  effects.send.mockResolvedValue(undefined); effects.google.mockResolvedValue({ synced: true }); effects.automation.mockResolvedValue([]);
  sql = createTestD1({ foreignKeys: true });
  sql.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','人工店舗','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','Uf','a',1);
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','人工担当','人工担当');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','人工メニュー',60,1000);
    INSERT INTO booking_settings(id,line_account_id,approval_mode) VALUES('bs','a','automatic');
    INSERT INTO conversion_points(id,name,event_type,status,line_account_id) VALUES('cp','人工成果','reservation_confirmed','active','a');
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES('b','a','f','s','m','2026-10-20T01:00:00Z','2026-10-20T02:00:00Z','2026-10-20T02:00:00Z','requested',1000,'2026-10-12T00:00:00Z');
    INSERT INTO booking_payments(id,line_account_id,booking_id,amount,provider,provider_payment_id,idempotency_key,status,created_at,updated_at)
      VALUES('p','a','b',1000,'fake','fake-p','booking:b','pending','2026-10-12','2026-10-12');`);
});
afterEach(() => { sql.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function count(table: string) { return (sql.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n; }

it('REV-H1/B-248: 別のDB接続のwebhookと回収でも確定メッセージを一度だけ送る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'train27-confirm-'));
  const file = join(dir, 'test.sqlite');
  await sql.raw.backup(file);
  const a = createTestD1({file,attach:true,foreignKeys:true});
  const b = createTestD1({file,attach:true,foreignKeys:true});
  try {
    await Promise.all([reconcilePaidBookingPayment(a.db,'p',now,true),reconcilePaidBookingPayment(b.db,'p',now,true)]);
    await recoverConfirmedBookingSideEffects(b.db, {now:new Date(now.getTime()+660000)});
    expect(effects.send).toHaveBeenCalledTimes(1);
    expect(effects.google).toHaveBeenCalledTimes(1);
    expect(effects.automation).toHaveBeenCalledTimes(1);
    expect((a.raw.prepare('SELECT COUNT(*) n FROM booking_reminders').get() as {n:number}).n).toBe(2);
  } finally { a.raw.close(); b.raw.close(); rmSync(dir,{recursive:true}); }
});

it.each([
  ['00:09 JST','2026-10-11T15:09:00.000Z'],
  ['08:59 JST','2026-10-11T23:59:00.000Z'],
])('REV-H時計: %sで確定しても前日09:00 JSTは12日00:00 UTCに登録する', async (_label, utc) => {
  const instant = new Date(utc); vi.setSystemTime(instant);
  sql.raw.exec(`UPDATE booking_settings SET reminder_day_before_time='09:00',timezone='Asia/Tokyo';
    UPDATE bookings SET starts_at='2026-10-13T01:00:00Z';`);
  await reconcilePaidBookingPayment(sql.db,'p',instant,true);
  expect(sql.raw.prepare("SELECT scheduled_at FROM booking_reminders WHERE kind='day_before'").get())
    .toEqual({scheduled_at:'2026-10-12T00:00:00.000Z'});
});

it('REV-H1/B-248: webhookと回収が重なっても確定通知・自動化・成果・リマインダを一度だけ', async () => {
  await Promise.all([
    reconcilePaidBookingPayment(sql.db, 'p', now, true),
    reconcilePaidBookingPayment(sql.db, 'p', now, true),
    recoverPaidBookingPayments(sql.db, now),
  ]);
  await recoverConfirmedBookingSideEffects(sql.db, { now: new Date(now.getTime()+660000) });
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  expect(effects.send).toHaveBeenCalledTimes(1);
  expect(effects.google).toHaveBeenCalledTimes(1);
  expect(effects.automation).toHaveBeenCalledTimes(1);
  expect(count('booking_reminders')).toBe(2);
  expect(sql.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='confirmed'").get()).toEqual({ n: 1 });
  expect(sql.raw.prepare("SELECT COUNT(*) n FROM conversion_events WHERE idempotency_key='cvsrc:reservation_confirmed:b'").get()).toEqual({ n: 1 });
});

it('REV-H1: 確定処理の記録に失敗すると決済と予約も戻り、次のwebhookで再開する', async () => {
  sql.raw.exec(`CREATE TRIGGER crash_workflow BEFORE INSERT ON booking_operation_runs
    WHEN NEW.idempotency_key='b:confirmation-effects' BEGIN SELECT RAISE(ABORT,'workflow failed'); END;`);
  await expect(reconcilePaidBookingPayment(sql.db, 'p', now, true)).rejects.toThrow('workflow failed');
  expect(sql.raw.prepare("SELECT status FROM bookings WHERE id='b'").get()).toEqual({status:'requested'});
  expect(sql.raw.prepare("SELECT status FROM booking_payments WHERE id='p'").get()).toEqual({status:'pending'});
  sql.raw.exec('DROP TRIGGER crash_workflow');
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  expect(effects.send).toHaveBeenCalledTimes(1);
});

it('REV-H1/B-248: 通知受理後に完了保存が落ちても再送せず、残りの処理を回収する', async () => {
  sql.raw.exec(`CREATE TRIGGER crash_line_completion BEFORE UPDATE ON booking_operation_runs
    WHEN NEW.kind='confirmation_line' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'completion lost'); END;
    CREATE TRIGGER crash_reminders BEFORE INSERT ON booking_reminders BEGIN SELECT RAISE(ABORT,'reminders failed'); END;`);
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  expect(effects.send).toHaveBeenCalledTimes(1); expect(count('booking_reminders')).toBe(0);
  sql.raw.exec('DROP TRIGGER crash_line_completion; DROP TRIGGER crash_reminders');
  await recoverConfirmedBookingSideEffects(sql.db, { now });
  expect(effects.send).toHaveBeenCalledTimes(1); expect(count('booking_reminders')).toBe(2);
  expect(sql.raw.prepare("SELECT status,error_code FROM booking_operation_runs WHERE kind='confirmation_line'").get())
    .toEqual({status:'permanent_failed',error_code:'delivery_unknown'});
});

it('REV-H1/B-248: 送信の到達不明を次の回収でも自動再送しない', async () => {
  effects.send.mockRejectedValue(new Error('accepted response lost'));
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  await recoverConfirmedBookingSideEffects(sql.db, { now: new Date(now.getTime()+86400000) });
  await runConfirmedBookingSideEffects(sql.db, 'b', { now });
  expect(effects.send).toHaveBeenCalledTimes(1);
  expect(effects.automation).toHaveBeenCalledTimes(1);
});

it('REV-H1: 通知準備前の中断は次の回収で続行し、送信開始済みは繰り返さない', async () => {
  sql.raw.exec(`UPDATE booking_payments SET status='paid'; UPDATE bookings SET status='confirmed';
    INSERT INTO booking_operation_runs(id,booking_id,line_account_id,kind,status,idempotency_key)
      VALUES('wf','b','a','automation','queued','b:confirmation-effects');
    INSERT INTO booking_operation_runs(id,booking_id,line_account_id,kind,status,idempotency_key,opened_at)
      VALUES('line','b','a','confirmation_line','queued','b:confirmation-line:approved','2026-10-11T23:00:00Z');`);
  await recoverConfirmedBookingSideEffects(sql.db, { now });
  expect(effects.send).toHaveBeenCalledTimes(1);
  await recoverConfirmedBookingSideEffects(sql.db, { now });
  expect(effects.send).toHaveBeenCalledTimes(1);
});

it('REV-H1: manualの支払いは確定しない、取消済み・旧版の確定済みには新規通知を送らない', async () => {
  sql.raw.exec("UPDATE booking_settings SET approval_mode='manual'");
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  expect(effects.send).not.toHaveBeenCalled(); expect(count('booking_reminders')).toBe(0);
  sql.raw.exec("UPDATE bookings SET status='confirmed'");
  await reconcilePaidBookingPayment(sql.db, 'p', now, true);
  expect(effects.send).not.toHaveBeenCalled();
  sql.raw.exec("UPDATE bookings SET status='cancelled'");
  await runConfirmedBookingSideEffects(sql.db, 'b', { now }); expect(effects.send).not.toHaveBeenCalled();
});

it('REV-H2: 旧版の支払い記録なし予約を10分で回収し、枠を空ける', async () => {
  sql.raw.exec(`DELETE FROM booking_payments;
    INSERT INTO booking_payment_configs(line_account_id,mode,provider,hold_minutes,created_at,updated_at)
      VALUES('a','online','fake',10,'2026-10-12','2026-10-12');`);
  await recoverOrphanedOnlineBookings(sql.db, new Date(now.getTime()+9*60000));
  expect(sql.raw.prepare("SELECT status FROM bookings WHERE id='b'").get()).toEqual({status:'requested'});
  await recoverOrphanedOnlineBookings(sql.db, new Date(now.getTime()+10*60000));
  expect(sql.raw.prepare("SELECT status FROM bookings WHERE id='b'").get()).toEqual({status:'expired'});
  expect(count('booking_slot_allocations')).toBe(0); expect(effects.send).not.toHaveBeenCalled();
});
