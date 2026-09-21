import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn() }));

const { friends } = await import('./friends.js');

/*
 * IDEA-02: 受信箱の顧客情報に出す「次の予定」。
 * 確定した未来の予約と自動配信の最先着を返し、「予定なし」(null) と
 * 「未取得」( *_Error=true ) を区別する。片方の取得失敗がもう片方を
 * 隠さないことも、実SQLite・実ルートで確かめる。
 */

const FUTURE = {
  soon: '2999-01-10T10:00:00.000Z',
  mid: '2999-01-11T10:00:00.000Z',
  late: '2999-01-12T10:00:00.000Z',
};
const PAST = '2000-01-01T10:00:00.000Z';

let db: SqliteD1;

beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`).run();
  db.raw.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U-friend-1', '田中', 'account-a')`).run();
  db.raw.prepare(`INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('staff-1', 'account-a', 'スタッフ', 'スタッフ')`).run();
  db.raw.prepare(`INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
    VALUES ('menu-1', 'account-a', 'カット', 60, 5000)`).run();
});
afterEach(() => { db.raw.close(); });

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'env-owner', name: 'owner', role: 'owner', readOnly: false });
    await next();
  });
  instance.route('/', friends);
  return instance;
}

type UpcomingBody = {
  success: boolean;
  data?: {
    nextBooking: { kind: string; id: string; title: string; startsAt: string; status: string } | null;
    nextBookingError: boolean;
    nextAutoDelivery: { kind: string; id: string; name: string; scheduledAt: string } | null;
    nextAutoDeliveryError: boolean;
  };
};

async function upcoming(friendId = 'friend-1') {
  const res = await app().request(`/api/friends/${friendId}/upcoming`, {}, { DB: db.db });
  return { status: res.status, body: (await res.json()) as UpcomingBody };
}

function seedBooking(id: string, startsAt: string, status = 'confirmed', menuName = 'カット') {
  db.raw.prepare(`INSERT INTO bookings
    (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at)
    VALUES (?, 'account-a', 'friend-1', 'staff-1', 'menu-1', ?, ?, ?, ?, 5000, ?)`)
    .run(id, startsAt, startsAt, startsAt, status, PAST);
  void menuName;
}

function seedEventBooking(id: string, startsAt: string, status = 'confirmed') {
  db.raw.prepare(`INSERT INTO events (id, line_account_id, name)
    VALUES ('event-${id}', 'account-a', '説明会')`).run();
  db.raw.prepare(`INSERT INTO event_slots (id, event_id, starts_at, ends_at)
    VALUES ('slot-${id}', 'event-${id}', ?, ?)`).run(startsAt, startsAt);
  db.raw.prepare(`INSERT INTO event_bookings
    (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
    VALUES (?, 'account-a', 'event-${id}', 'slot-${id}', 'friend-1', ?, ?)`)
    .run(id, status, PAST);
}

function seedMeet(id: string, startsAt: string, status = 'confirmed') {
  db.raw.prepare(`INSERT INTO meet_consultations
    (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status)
    VALUES (?, 'ext-${id}', 'friend-1', '個別相談', ?, ?, 'https://meet.example.test/${id}', ?)`)
    .run(id, startsAt, startsAt, status);
}

function seedScenario(id: string, status: string, nextDeliveryAt: string | null) {
  db.raw.prepare(`INSERT INTO scenarios (id, name, trigger_type) VALUES (?, ?, 'manual')`)
    .run(`scenario-${id}`, `シナリオ${id}`);
  db.raw.prepare(`INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at)
    VALUES (?, 'friend-1', ?, ?, ?)`)
    .run(`fs-${id}`, `scenario-${id}`, status, nextDeliveryAt);
}

function seedReminderRun(id: string, scheduledAt: string, status = 'queued') {
  db.raw.prepare(`INSERT INTO reminders (id, name) VALUES ('reminder-${id}', ?)`).run(`リマインダ${id}`);
  db.raw.prepare(`INSERT INTO reminder_delivery_runs
    (id, reminder_id, friend_reminder_id, friend_id, reminder_step_id, scheduled_at,
     idempotency_key, line_retry_key, status, created_at, updated_at)
    VALUES (?, 'reminder-${id}', 'fr-${id}', 'friend-1', 'step-${id}', ?, ?, ?, ?, ?, ?)`)
    .run(`run-${id}`, scheduledAt, `idem-${id}`, `retry-${id}`, status, PAST, PAST);
}

describe('GET /api/friends/:id/upcoming (IDEA-02)', () => {
  test('存在しない友だちは404', async () => {
    const { status, body } = await upcoming('missing');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  test('予定が無いときは null と error=false を返す（未取得と予定なしを区別）', async () => {
    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data).toEqual({
      nextBooking: null,
      nextBookingError: false,
      nextAutoDelivery: null,
      nextAutoDeliveryError: false,
    });
  });

  test('予約・イベント予約・個別相談の中で最先着を返す', async () => {
    seedBooking('b1', FUTURE.late);
    seedEventBooking('e1', FUTURE.mid);
    seedMeet('m1', FUTURE.soon);

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextBooking).toMatchObject({
      kind: 'meet_consultation',
      id: 'm1',
      startsAt: FUTURE.soon,
    });
  });

  test('過去・取消の予約は次回予約にしない', async () => {
    seedBooking('b-past', PAST);
    seedBooking('b-cancelled', FUTURE.soon, 'cancelled');
    seedEventBooking('e-past', PAST);
    seedMeet('m-cancelled', FUTURE.soon, 'cancelled');

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextBooking).toBeNull();
    expect(body.data?.nextBookingError).toBe(false);
  });

  test('確定した自動配信の最先着を返し、paused のシナリオは含めない', async () => {
    // paused は時刻が早くても「確定した予定」ではないので除く。
    seedScenario('paused', 'paused', FUTURE.soon);
    seedScenario('active', 'active', FUTURE.late);
    seedReminderRun('r1', FUTURE.mid);
    // 終了・失敗した実行は予定ではない。
    seedReminderRun('done', FUTURE.soon, 'succeeded');

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextAutoDelivery).toMatchObject({
      kind: 'reminder',
      id: 'reminder-r1',
      scheduledAt: FUTURE.mid,
    });
  });

  test('シナリオだけのときはその確定次通を返す', async () => {
    seedScenario('only', 'delivering', FUTURE.mid);

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextAutoDelivery).toMatchObject({
      kind: 'scenario',
      id: 'scenario-only',
      scheduledAt: FUTURE.mid,
    });
  });

  test('片方の取得失敗でもう片方を隠さない（予約側だけ失敗）', async () => {
    seedScenario('ok', 'active', FUTURE.mid);
    db.raw.exec('DROP TABLE bookings');

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextBooking).toBeNull();
    expect(body.data?.nextBookingError).toBe(true);
    expect(body.data?.nextAutoDelivery).toMatchObject({ kind: 'scenario', id: 'scenario-ok' });
    expect(body.data?.nextAutoDeliveryError).toBe(false);
  });

  test('片方の取得失敗でもう片方を隠さない（配信側だけ失敗）', async () => {
    seedBooking('b1', FUTURE.mid);
    db.raw.exec('DROP TABLE reminder_delivery_runs');
    db.raw.exec('DROP TABLE friend_scenarios');

    const { status, body } = await upcoming();
    expect(status).toBe(200);
    expect(body.data?.nextBooking).toMatchObject({ kind: 'booking', id: 'b1' });
    expect(body.data?.nextBookingError).toBe(false);
    expect(body.data?.nextAutoDelivery).toBeNull();
    expect(body.data?.nextAutoDeliveryError).toBe(true);
  });
});
