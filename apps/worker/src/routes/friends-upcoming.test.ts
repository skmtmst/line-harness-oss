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
    items: import('@line-crm/shared').FriendUpcomingItem[];
    itemsError: boolean;
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
      items: [],
      itemsError: false,
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


describe('進行中の配信一覧', () => {
  test('複数シナリオと予約配信を日時順で返し、対象外・停止中は除く', async () => {
    seedScenario('a', 'active', FUTURE.late);
    seedScenario('b', 'delivering', FUTURE.soon);
    seedScenario('paused', 'paused', FUTURE.soon);
    db.raw.prepare(`INSERT INTO broadcasts (id, title, message_type, message_content,
      status, scheduled_at, line_account_id, target_type, target_tag_id)
      VALUES (?, ?, 'text', '試験', 'scheduled', ?, ?, ?, ?)`)
      .run('broadcast-1', '予約配信', FUTURE.mid, 'account-a', 'all', null);
    db.raw.prepare(`INSERT INTO broadcasts (id, title, message_type, message_content,
      status, scheduled_at, line_account_id, target_type, target_tag_id)
      VALUES ('excluded', '対象外', 'text', '試験', 'scheduled', ?, 'account-a', 'tag', 'missing-tag')`)
      .run(FUTURE.soon);
    const { body } = await upcoming();
    expect(body.data?.itemsError).toBe(false);
    expect(body.data?.items.map(i => i.kind)).toEqual(['scenario', 'broadcast', 'scenario']);
    expect(body.data?.items[1]).toMatchObject({ sentCount: 0, totalCount: 1,
      href: '/broadcasts/detail?id=broadcast-1' });
    expect(body.data?.nextAutoDelivery?.id).toBe('scenario-b');
  });
  test('20件に制限し、日時未確定の進行中も含める', async () => {
    for (let i = 0; i < 22; i++) seedScenario(String(i), 'active', FUTURE.mid);
    seedScenario('unknown', 'active', null);
    const { body } = await upcoming();
    expect(body.data?.items).toHaveLength(20);
    db.raw.prepare(`DELETE FROM friend_scenarios WHERE id != 'fs-unknown'`).run();
    const next = await upcoming();
    expect(next.body.data?.items[0].scheduledAt).toBeNull();
  });
  test('リマインダは登録単位でまとめ、送信済み件数を返す', async () => {
    seedReminderRun('r', FUTURE.mid);
    db.raw.prepare(`INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date)
      VALUES ('fr-r', 'friend-1', 'reminder-r', '2999-01-12')`).run();
    db.raw.prepare(`INSERT INTO friend_reminder_deliveries
      (id, friend_reminder_id, reminder_step_id) VALUES ('done', 'fr-r', 'step-done')`).run();
    const { body } = await upcoming();
    expect(body.data?.items).toHaveLength(1);
    expect(body.data?.items[0]).toMatchObject({ kind: 'reminder', sentCount: 1, scheduledAt: FUTURE.mid });
  });
  test('取得失敗を空の予定と区別し、従来の予定を残す', async () => {
    seedScenario('a', 'active', FUTURE.soon);
    db.raw.exec('DROP TABLE automation_runs');
    const { body } = await upcoming();
    expect(body.data?.itemsError).toBe(true);
    expect(body.data?.nextAutoDelivery?.id).toBe('scenario-a');
  });
});


test('自動化は稼働中だけを返し、試し実行・他のアカウントは除く', async () => {
  db.raw.prepare(`INSERT INTO automation_definitions (id, line_account_id, name)
    VALUES ('automation-1', 'account-a', '待機処理')`).run();
  const insert = db.raw.prepare(`INSERT INTO automation_runs
    (id, line_account_id, automation_id, automation_version_id, friend_id, source_event_id,
     idempotency_key, status, resume_at, is_test) VALUES (?, ?, 'automation-1', 'v1',
      'friend-1', ?, ?, ?, ?, ?)`);
  insert.run('run-1', 'account-a', 'e1', 'i1', 'waiting', FUTURE.mid, 0);
  insert.run('test-run', 'account-a', 'e2', 'i2', 'waiting', FUTURE.soon, 1);
  insert.run('other-run', 'account-b', 'e3', 'i3', 'waiting', FUTURE.soon, 0);
  insert.run('done-run', 'account-a', 'e4', 'i4', 'success', FUTURE.soon, 0);
  const { body } = await upcoming();
  expect(body.data?.items).toHaveLength(1);
  expect(body.data?.items[0]).toMatchObject({ kind: 'automation', id: 'run-1', sentCount: null, totalCount: null });
});

test('一斉配信の条件判定とアカウント境界を守る', async () => {
  const insert = db.raw.prepare(`INSERT INTO broadcasts (id, title, message_type, message_content,
    status, scheduled_at, line_account_id, target_type, segment_conditions, stopped_at)
    VALUES (?, '絞り込み', 'text', '試験', 'scheduled', ?, ?, 'segment', ?, ?)`);
  const condition = (name: string) => JSON.stringify({ operator: 'AND', rules: [{ type: 'name', value: { text: name } }] });
  insert.run('included', FUTURE.mid, 'account-a', condition('田中'), null);
  insert.run('excluded', FUTURE.mid, 'account-a', condition('対象外'), null);
  insert.run('other', FUTURE.mid, 'account-b', condition('田中'), null);
  insert.run('stopped', FUTURE.mid, 'account-a', condition('田中'), PAST);
  const { body } = await upcoming();
  expect(body.data?.itemsError).toBe(false);
  expect(body.data?.items.map(i => i.id)).toEqual(['included']);
});
