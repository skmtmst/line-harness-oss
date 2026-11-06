import { Hono } from 'hono';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { promoteEventWaitlist } from '../services/event-waitlist.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineUserId: vi.fn(async () => 'U1'),
  verifyCallerLineIdentity: vi.fn(async () => ({
    lineUserId: 'U1',
    lineAccountId: 'a',
  })),
}));
vi.mock('../services/event-booking-notifier.js', () => ({
  sendEventBookingNotification: vi.fn(async () => {}),
  renderEventNotificationText: vi.fn(() => ''),
}));
import events from './events.js';
let f: ReturnType<typeof createTestD1>, app: Hono<Env>;
beforeEach(() => {
  f = createTestD1();
  f.raw.exec(
    `INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id) VALUES('a','a','店','token','secret','L1');INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f1','U1','a',1),('f2','U2','a',1),('f3','U3','a',1);INSERT INTO events(id,line_account_id,name,is_published,lifecycle_status,waitlist_enabled,max_bookings_per_friend) VALUES('e','a','クラス',1,'published',1,3);INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,classroom_capacity,online_capacity,is_active) VALUES('s','e','2099-06-01T00:00:00Z','2099-06-01T01:00:00Z',2,1,1,1);INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at,identity_key) VALUES('taken','a','e','s','f2','confirmed','2026-10-01','f2');`,
  );
  app = new Hono<Env>();
  app.route('/', events);
});
afterEach(() => f.raw.close());
const book = (mode: string, key = 'key-12345678') =>
  app.request(
    '/api/liff/events/e/bookings?liffId=L1',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        Authorization: 'Bearer test',
      },
      body: JSON.stringify({ slot_id: 's', participation_mode: mode }),
    },
    { DB: f.db, WORKER_URL: 'https://worker.test' } as Env['Bindings'],
  );
test('online reservation uses the online pool even when the classroom is full', async () => {
  const r = await book('online');
  expect(r.status).toBe(201);
  expect(
    f.raw
      .prepare(
        "SELECT participation_mode FROM event_bookings WHERE friend_id='f1'",
      )
      .get(),
  ).toEqual({ participation_mode: 'online' });
});
test('保存後に送信処理が走らなくても、予約・通知・リマインダの予定が同時に残る',async()=>{
  f.raw.exec('UPDATE events SET reminder_day_before_enabled=1,reminder_hours_before=1');
  const response=await book('online');expect(response.status).toBe(201);
  const body=await response.json<{id:string}>();
  expect(f.raw.prepare("SELECT status FROM workflow_steps WHERE process_kind='booking_line_delivery'").all()).toEqual([{status:'pending'}]);
  expect(f.raw.prepare('SELECT kind,status FROM event_booking_reminders WHERE booking_id=? ORDER BY kind').all(body.id))
    .toEqual([{kind:'day_before',status:'pending'},{kind:'hours_before',status:'pending'}]);
});
test('通知予定の保存障害では予約も戻し、片側だけ成立させない',async()=>{
  f.raw.exec(`CREATE TRIGGER stop_plan BEFORE INSERT ON workflow_steps WHEN NEW.process_kind='booking_line_delivery'
    BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  expect((await book('online')).status).toBe(500);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM event_bookings WHERE friend_id='f1'").get()).toEqual({n:0});
});
test('並行する2人でも最後の1席は1予約・1通知だけ。落選側は待ちへ進む',async()=>{
  vi.mocked(verifyCallerLineUserId).mockResolvedValueOnce('U1').mockResolvedValueOnce('U3');
  const responses=await Promise.all([book('online','parallel-1'),book('online','parallel-2')]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,201]);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM event_bookings WHERE participation_mode='online'").get()).toEqual({n:1});
  expect(f.raw.prepare("SELECT COUNT(*) n FROM workflow_steps WHERE process_kind='booking_line_delivery'").get()).toEqual({n:1});
});
test('full classroom goes into the classroom queue and preserves the mode', async () => {
  const r = await book('classroom');
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ waitlisted: true });
  expect(
    f.raw
      .prepare(
        "SELECT participation_mode,status FROM event_waitlist WHERE friend_id='f1'",
      )
      .get(),
  ).toEqual({ participation_mode: 'classroom', status: 'waiting' });
});
test('a full classroom queue does not block the next online offer', async () => {
  f.raw.exec(
    `INSERT INTO event_waitlist(id,line_account_id,event_id,slot_id,friend_id,identity_key,status,party_size,participation_mode,created_at,updated_at) VALUES('wc','a','e','s','f1','f1','waiting',1,'classroom','2026-01-01','2026-01-01'),('wo','a','e','s','f3','f3','waiting',1,'online','2026-01-02','2026-01-02')`,
  );
  const result = await promoteEventWaitlist(f.db, {
    occurrenceId: 's',
    lineAccountId: 'a',
    sender: vi.fn(async () => {}),
  });
  expect(result.kind).toBe('promoted');
  expect(
    f.raw.prepare('SELECT id,status FROM event_waitlist ORDER BY id').all(),
  ).toEqual([
    { id: 'wc', status: 'waiting' },
    { id: 'wo', status: 'offered' },
  ]);
});
