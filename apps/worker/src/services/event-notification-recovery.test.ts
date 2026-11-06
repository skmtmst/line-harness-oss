import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { deliverBookingLine } from '../features/booking/booking-line-delivery.js';
import { recoverEventBookingNotifications } from './event-notification-recovery.js';
import { prepareEventNotification, prepareConfirmedEventBooking } from './event-notification-plan.js';
import { prepareEventReminders } from './event-reminder-plan.js';

const push = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: class { pushMessage = push; } }));
let fixture: SqliteD1;
const now = new Date('2030-01-01T00:00:00Z');
beforeEach(() => {
  fixture = createTestD1();
  push.mockReset().mockResolvedValue(undefined);
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('a','channel','A','fixture-token','fixture-secret');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','U1','a',1);
    INSERT INTO events(id,line_account_id,name,target_type) VALUES('e','a','Event','single');
    INSERT INTO event_slots(id,event_id,starts_at,ends_at) VALUES('s','e','2030-01-02','2030-01-03');
    INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at)
      VALUES('b','a','e','s','f','confirmed','2030-01-01');`);
});
afterEach(() => fixture.raw.close());

const options = () => ({ accountId: 'a', operationId: 'event-booking:b:confirmed:s',
  snapshot: { to: 'U1', messages: [{ type: 'text' as const, text: 'Saved original' }],
    subject: { bookingId: 'b', slotId: 's', status: 'confirmed', startsAt:'2030-01-02' } },
  now: () => now.getTime(), authorize: async () => true,
  send: vi.fn(async () => undefined),
});

it.each([false,true])('管理者確定CASと予定を一体保存、予定保存障害=%sで承認待ちを保つ',async failPlan=>{
  fixture.raw.exec("UPDATE event_bookings SET status='requested'; UPDATE events SET reminder_day_before_enabled=1,reminder_hours_before=1");
  if(failPlan)fixture.raw.exec(`CREATE TRIGGER crash_plan BEFORE INSERT ON workflow_steps
    WHEN NEW.process_kind='booking_line_delivery' BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  const plans=await prepareConfirmedEventBooking(fixture.db,'b',now);
  const transaction=()=>fixture.db.batch([fixture.db.prepare("UPDATE event_bookings SET status='confirmed' WHERE id='b' AND status='requested'"),...plans]);
  if(failPlan){
    await expect(transaction()).rejects.toThrow('fixture');
    expect(fixture.raw.prepare("SELECT status FROM event_bookings WHERE id='b'").get()).toEqual({status:'requested'});
  }else{
    await transaction();
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({n:2});
    expect(await recoverEventBookingNotifications(fixture.db,now,100)).toEqual({sent:1,failed:0});
  }
});

it.each([false,true])('予約と通知/リマインダ予定を一体保存、予定保存障害=%sでは全体を戻す',async failPlan=>{
  fixture.raw.exec('DELETE FROM event_bookings');
  if(failPlan)fixture.raw.exec(`CREATE TRIGGER crash_plan BEFORE INSERT ON workflow_steps
    WHEN NEW.process_kind='booking_line_delivery' BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  const plan=await prepareEventNotification(fixture.db,{accountId:'a',operationId:'event-booking:b:confirmed:s',to:'U1',
    kind:'received_confirmed',ctx:{eventName:'Saved event',startsAtJst:'2030-01-02 09:00'},
    subject:{bookingId:'b',slotId:'s',status:'confirmed'},now});
  const transaction=()=>fixture.db.batch([
    fixture.db.prepare(`INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at)
      VALUES('b','a','e','s','f','confirmed','2030-01-01')`),plan,
    ...prepareEventReminders(fixture.db,'b',[{kind:'day_before',scheduled_at:now.toISOString()}],true),
  ]);
  if(failPlan){
    await expect(transaction()).rejects.toThrow('fixture');
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_bookings').get()).toEqual({n:0});
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({n:0});
    expect(await recoverEventBookingNotifications(fixture.db,now,100)).toEqual({sent:0,failed:0});
  }else{
    await transaction(); // HTTP側がこの直後で停止しても、cronが元の予定を回収できる。
    expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({n:1});
    expect(await recoverEventBookingNotifications(fixture.db,now,100)).toEqual({sent:1,failed:0});
    expect(push).toHaveBeenCalledWith('U1',[expect.objectContaining({text:expect.stringContaining('Saved event')})],expect.any(String));
    expect(await recoverEventBookingNotifications(fixture.db,now,100)).toEqual({sent:0,failed:0});
  }
});

it('記録後・送信開始前の停止から元の宛先/本文/キーで1回だけ回収する', async () => {
  const input = options();
  // 送信前のチェックポイント保存障害なら要求は0。pendingを次のcronが回収する。
  fixture.raw.exec(`CREATE TRIGGER stop_before_send BEFORE UPDATE ON workflow_steps
    WHEN NEW.process_kind='booking_line_delivery' BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  await expect(deliverBookingLine(fixture.db, input)).rejects.toThrow('delivery_incomplete');
  expect(input.send).not.toHaveBeenCalled();
  fixture.raw.exec('DROP TRIGGER stop_before_send');
  expect(await recoverEventBookingNotifications(fixture.db, now, 100)).toEqual({ sent: 1, failed: 0 });
  expect(push).toHaveBeenCalledWith('U1', input.snapshot.messages, expect.any(String));
  expect(await recoverEventBookingNotifications(fixture.db, now, 100)).toEqual({ sent: 0, failed: 0 });
  expect(push).toHaveBeenCalledTimes(1);
});

it('送信後の応答消失を別cronから再送しない', async () => {
  const input = options();
  input.send.mockRejectedValue(new Error('lost response'));
  await expect(deliverBookingLine(fixture.db, input)).rejects.toThrow('delivery_unknown');
  expect(await recoverEventBookingNotifications(fixture.db, now, 100)).toEqual({ sent: 0, failed: 0 });
  expect(push).not.toHaveBeenCalled();
  expect(input.send).toHaveBeenCalledTimes(1);
});

it('予約の取消・宛先変更・フォロー解除は保存済みの通知も送らない', async () => {
  for (const mutation of ["UPDATE event_bookings SET status='cancelled'",
    "UPDATE friends SET line_user_id='other'", 'UPDATE friends SET is_following=0',"UPDATE event_slots SET starts_at='2031-01-01'"]) {
    const input = options();
    fixture.raw.exec(`CREATE TRIGGER stop_before_send BEFORE UPDATE ON workflow_steps
      WHEN NEW.process_kind='booking_line_delivery' BEGIN SELECT RAISE(ABORT,'fixture'); END`);
    await expect(deliverBookingLine(fixture.db, input)).rejects.toThrow();
    fixture.raw.exec('DROP TRIGGER stop_before_send');
    fixture.raw.exec(mutation);
    expect(await recoverEventBookingNotifications(fixture.db, now, 100)).toEqual({ sent: 0, failed: 0 });
    expect(push).not.toHaveBeenCalled();
    expect(fixture.raw.prepare("SELECT status FROM workflow_steps WHERE process_kind='booking_line_delivery'").get())
      .toEqual({ status: 'canceled' });
    fixture.raw.exec("DELETE FROM workflow_steps; UPDATE event_bookings SET status='confirmed'; UPDATE friends SET line_user_id='U1',is_following=1; UPDATE event_slots SET starts_at='2030-01-02'");
  }
});
