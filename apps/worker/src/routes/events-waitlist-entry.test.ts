/*
 * 満席の申込がキャンセル待ちへ入ること (#747 / N-416)。
 *
 * 満席には**2つの負け方**がある。
 *  1. 申し込む前から埋まっていた (申込前の空き確認で分かる)
 *  2. 申し込んでから、同時に来た別の人に負けた (INSERT 後の再検査で分かる)
 *
 * **2 だけが待ち行列へ入らず `slot_full` で終わっていた。**利用者から見れば
 * どちらも「満席だった」で、区別がつかない。画面が満席の枠を押せるように
 * なった以上、この道は日常的に通る。
 *
 * 実 SQLite(bootstrap.sql)に本物の events ルートを載せて、実際に
 * event_waitlist の行が増えるところまで見る。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: true,
  })),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const liffAuthMocks = vi.hoisted(() => ({
  verifyCallerLineUserId: vi.fn(async () => 'U-friend-1'),
  verifyCallerLineIdentity: vi.fn(async () => ({
    lineUserId: 'U-friend-1',
    lineAccountId: 'account-1',
  })),
}));
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

// LINE へは出さない。待ちへ入ったかどうかだけを見る。
const notifierMocks = vi.hoisted(() => ({
  sendEventBookingNotification: vi.fn(async () => {}),
  renderEventNotificationText: vi.fn(() => ''),
}));
vi.mock('../services/event-booking-notifier.js', () => notifierMocks);

const { default: events } = await import('./events.js');

const FUTURE = '2099-06-01T10:00:00.000Z';

type Raw = import('better-sqlite3').Database;

function seed(raw: Raw, opts: { capacity: number | null; waitlist: 0 | 1 }): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
     VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', 'L1')`,
  ).run();
  for (const [id, user] of [['friend-1', 'U-friend-1'], ['friend-2', 'U-friend-2']]) {
    raw.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
       VALUES (?, ?, ?, 'account-1', 1)`,
    ).run(id, user, id);
  }
  raw.prepare(
    `INSERT INTO events
       (id, line_account_id, name, target_type, is_published, requires_approval,
        max_bookings_per_friend, waitlist_enabled)
     VALUES ('ev-1', 'account-1', '体験会', 'single', 1, 0, 3, ?)`,
  ).run(opts.waitlist);
  raw.prepare(
    `INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active)
     VALUES ('slot-1', 'ev-1', ?, ?, ?, 1)`,
  ).run(FUTURE, FUTURE, opts.capacity);
}

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.route('/', events);
  return {
    app,
    env: { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'tok', WORKER_URL: 'https://w.test' },
  };
}

async function book(app: Hono<Env>, env: unknown, key: string, liffId = 'L1', slotId = 'slot-1', partySize = 1) {
  const res = await app.request(
    `/api/liff/events/ev-1/bookings?liffId=${liffId}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': key,
        Authorization: `Bearer ${liffId}`,
      },
      body: JSON.stringify({ slot_id: slotId, party_size: partySize }),
    },
    env as Record<string, unknown>,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function waitlistRows(raw: Raw): Array<{ friend_id: string; status: string }> {
  return raw
    .prepare(`SELECT friend_id, status FROM event_waitlist ORDER BY friend_id`)
    .all() as Array<{ friend_id: string; status: string }>;
}

function bookingRows(raw: Raw): Array<{ friend_id: string; status: string }> {
  return raw
    .prepare(`SELECT friend_id, status FROM event_bookings ORDER BY friend_id`)
    .all() as Array<{ friend_id: string; status: string }>;
}

/** 2人ぶんの要求を同時に投げる。呼ばれた順に別の人として通す。 */
function racingCallers(): void {
  let turn = 0;
  liffAuthMocks.verifyCallerLineUserId.mockImplementation(async () => {
    turn += 1;
    return turn === 1 ? 'U-friend-1' : 'U-friend-2';
  });
}

/** SQLの結果は変えず、指定した書き込み直前で要求の順番だけを固定する。 */
function pauseBefore(db: D1Database, matches: (sql: string) => boolean) {
  let reached!: () => void;
  let resume!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  let intercepted = false;
  const prepare = db.prepare.bind(db);
  const wrapped = {
    ...db,
    prepare(sql: string) {
      const statement = prepare(sql);
      if (!matches(sql)) return statement;
      const bind = statement.bind.bind(statement);
      return {
        ...statement,
        bind(...args: unknown[]) {
          const bound = bind(...args);
          return {
            ...bound,
            async run() {
              if (!intercepted) {
                intercepted = true;
                reached();
                await released;
              }
              return bound.run();
            },
          };
        },
      };
    },
  } as D1Database;
  return { db: wrapped, ready, resume };
}

describe('待ち登録が先に確定する競合', () => {
  it.each(['offered', 'accepted'])('別枠で席を保留済み（%s）なら後発予約も本人上限を守る', async (status) => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = 1').run();
    raw.prepare(`INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active)
      VALUES ('slot-other', 'ev-1', ?, ?, 1, 1)`).run(FUTURE, FUTURE);
    raw.prepare(`INSERT INTO event_waitlist
      (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, created_at, updated_at)
      VALUES ('held', 'account-1', 'ev-1', 'slot-1', 'friend-1', 'solo:friend-1', ?, ?, ?)`).run(status, FUTURE, FUTURE);
    const { app, env } = makeApp(db);
    expect((await book(app, env, 'after-offer', 'L1', 'slot-other')).status).toBe(409);
    expect(bookingRows(raw)).toEqual([]);
    expect(waitlistRows(raw)).toEqual([{ friend_id: 'friend-1', status }]);
    expect(notifierMocks.sendEventBookingNotification).not.toHaveBeenCalled();
    raw.close();
  });

  it('同じ枠で人数の違う別キー申込が並走しても待ちの順番と人数を保つ', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = 1').run();
    const gate = pauseBefore(db, sql => /INSERT INTO event_bookings/.test(sql));
    const { app, env } = makeApp(gate.db);
    const booking = book(app, env, 'race-small');
    await gate.ready;
    const waiting = await book(app, env, 'race-large', 'L1', 'slot-1', 2);
    const before = raw.prepare('SELECT * FROM event_waitlist').all();
    gate.resume();
    const booked = await booking;
    expect(waiting).toMatchObject({ status: 200, body: { waitlisted: true } });
    expect(booked).toMatchObject({ status: 409, body: { error: 'duplicate_friend_booking' } });
    expect(bookingRows(raw)).toEqual([]);
    expect(raw.prepare('SELECT * FROM event_waitlist').all()).toEqual(before);
    expect(before).toMatchObject([{ party_size: 2, status: 'waiting' }]);
    expect(notifierMocks.sendEventBookingNotification).not.toHaveBeenCalled();
    raw.close();
  });

  it('別枠のwaitingは即時予約を妨げず、本人上限1に達したら繰上げで席を取らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 0, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = 1').run();
    raw.prepare(`INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active)
      VALUES ('slot-other', 'ev-1', ?, ?, 1, 1)`).run(FUTURE, FUTURE);
    const gate = pauseBefore(db, sql => /INSERT INTO event_bookings/.test(sql));
    const { app, env } = makeApp(gate.db);
    const booking = book(app, env, 'race-other', 'L1', 'slot-other');
    await gate.ready;
    const waiting = await book(app, env, 'race-full');
    const before = raw.prepare('SELECT * FROM event_waitlist').all();
    gate.resume();
    const booked = await booking;
    expect(waiting).toMatchObject({ status: 200, body: { waitlisted: true } });
    expect(booked.status).toBe(201);
    raw.prepare(`UPDATE event_slots SET capacity = 1 WHERE id = 'slot-1'`).run();
    const { promoteEventWaitlist } = await import('../services/event-waitlist.js');
    const sender = vi.fn(async () => {});
    expect(await promoteEventWaitlist(db, {
      occurrenceId: 'slot-1', lineAccountId: 'account-1', sender,
    })).toMatchObject({ kind: 'noop', reason: 'applicant_ineligible' });
    expect(sender).not.toHaveBeenCalled();
    expect(raw.prepare('SELECT * FROM event_waitlist').all()).toEqual(before);
    expect(bookingRows(raw)).toEqual([{ friend_id: 'friend-1', status: 'confirmed' }]);
    raw.close();
  });

  it('満席確認と待ち登録の間に取消・同枠再申込が走っても先着の待ちを残す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = 1').run();
    raw.prepare(`INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, requested_at)
      VALUES ('occupant', 'account-1', 'ev-1', 'slot-1', 'friend-2', 'solo:friend-2', 'confirmed', ?)`).run(FUTURE);
    const waitGate = pauseBefore(db, sql => /INSERT OR IGNORE INTO event_waitlist/.test(sql));
    const bookingGate = pauseBefore(waitGate.db, sql => /INSERT INTO event_bookings/.test(sql));
    const { app, env } = makeApp(bookingGate.db);
    const waitingRequest = book(app, env, 'before-cancel');
    await waitGate.ready;
    raw.prepare(`UPDATE event_bookings SET status = 'cancelled' WHERE id = 'occupant'`).run();
    const bookingRequest = book(app, env, 'after-cancel');
    await bookingGate.ready;
    waitGate.resume();
    expect((await waitingRequest).status).toBe(200);
    const before = raw.prepare('SELECT * FROM event_waitlist').all();
    bookingGate.resume();
    expect(await bookingRequest).toMatchObject({ status: 409, body: { error: 'duplicate_friend_booking' } });
    expect(bookingRows(raw)).toEqual([{ friend_id: 'friend-2', status: 'cancelled' }]);
    expect(raw.prepare('SELECT * FROM event_waitlist').all()).toEqual(before);
    expect(notifierMocks.sendEventBookingNotification).not.toHaveBeenCalled();
    raw.close();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U-friend-1');
});

describe('前から満席だった申込', () => {
  it('待ち登録済みの本人が別キーで再送しても同じ待ち1件を返す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 0, waitlist: 1 });
    const { app, env } = makeApp(db);
    expect(await book(app, env, 'waiting-first')).toMatchObject({ status: 200, body: { waitlisted: true } });
    expect(await book(app, env, 'waiting-repeat')).toMatchObject({ status: 200, body: { waitlisted: true } });
    expect(waitlistRows(raw)).toEqual([{ friend_id: 'friend-1', status: 'waiting' }]);
    raw.close();
  });

  it('待ちが有効なら待ち行列へ入り、200 で待ちと分かる形を返す', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, requested_at, party_size)
       VALUES ('eb-1', 'account-1', 'ev-1', 'slot-1', 'friend-1', 'confirmed',
               '2026-01-01T00:00:00.000Z', 1)`,
    ).run();
    const { app, env } = makeApp(db);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U-friend-2');

    const res = await book(app, env, 'k-wait');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ waitlisted: true, slot_id: 'slot-1' });
    expect(waitlistRows(raw)).toEqual([{ friend_id: 'friend-2', status: 'waiting' }]);
  });

  it('待ちが無効なら 409 で断り、待ち行列も増やさない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 0 });
    raw.prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, requested_at, party_size)
       VALUES ('eb-1', 'account-1', 'ev-1', 'slot-1', 'friend-1', 'confirmed',
               '2026-01-01T00:00:00.000Z', 1)`,
    ).run();
    const { app, env } = makeApp(db);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U-friend-2');

    const res = await book(app, env, 'k-nowait');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'slot_full' });
    expect(waitlistRows(raw)).toEqual([]);
  });
});

describe('同時申込で負けた申込', () => {
  it.each([1, 3, null])('同じ本人が別キーで同時申込しても、予約と待ちに二重所属しない（本人上限 %s）', async (max) => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = ?').run(max);
    const { app, env } = makeApp(db);
    const results = await Promise.all([book(app, env, 'same-a'), book(app, env, 'same-b')]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(results.find(result => result.status === 409)?.body).toMatchObject({ error: 'duplicate_friend_booking' });
    expect(bookingRows(raw)).toEqual([{ friend_id: 'friend-1', status: 'confirmed' }]);
    expect(waitlistRows(raw)).toEqual([]);
    raw.close();
  });

  it('満席の回を別キーで送り直しても、成立済みの本人を待ちへ入れない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    const { app, env } = makeApp(db);
    expect((await book(app, env, 'first')).status).toBe(201);
    const repeat = await book(app, env, 'second');
    expect(repeat.status).toBe(409);
    expect(repeat.body).toMatchObject({ error: 'duplicate_friend_booking' });
    expect(bookingRows(raw)).toHaveLength(1);
    expect(waitlistRows(raw)).toEqual([]);
    raw.close();
  });

  it('別の回ですでに本人上限に達している場合も待ちへ入れない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 0, waitlist: 1 });
    raw.prepare('UPDATE events SET max_bookings_per_friend = 2').run();
    raw.prepare(`INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active)
                 VALUES ('slot-other', 'ev-1', ?, ?, 5, 1)`).run(FUTURE, FUTURE);
    for (const id of ['existing-a', 'existing-b']) {
      raw.prepare(`INSERT INTO event_bookings
        (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, requested_at)
        VALUES (?, 'account-1', 'ev-1', 'slot-other', 'friend-1', 'solo:friend-1', 'confirmed', ?)`).run(id, FUTURE);
    }
    const { app, env } = makeApp(db);
    const result = await book(app, env, 'over-limit');
    expect(result).toMatchObject({ status: 409, body: { error: 'over_friend_limit' } });
    expect(waitlistRows(raw)).toEqual([]);
    raw.close();
  });

  it('共有イベントなら別アカウントの同一identityの同時申込も二重所属しない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
      VALUES ('account-2', 'channel-2', '支店', 'token', 'secret', 'L2')`).run();
    raw.prepare(`UPDATE friends SET user_id = 'shared-user' WHERE id = 'friend-1'`).run();
    raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following, user_id)
      VALUES ('friend-shared', 'U-shared', 'account-2', 1, 'shared-user')`).run();
    liffAuthMocks.verifyCallerLineUserId.mockImplementation(async (auth?: string | null) =>
      auth === 'Bearer L2' ? 'U-shared' : 'U-friend-1');
    raw.prepare(`UPDATE events SET target_type = 'multi-account-dedup', account_ids = '["account-1","account-2"]'`).run();
    const { app, env } = makeApp(db);
    const results = await Promise.all([book(app, env, 'account-a'), book(app, env, 'account-b', 'L2')]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(results.find(result => result.status === 409)?.body).toMatchObject({ error: 'duplicate_friend_booking' });
    expect(bookingRows(raw)).toHaveLength(1);
    expect(waitlistRows(raw)).toEqual([]);
    raw.close();
  });

  it('公開対象外のアカウントから満席イベントの待ちに入れない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 0, waitlist: 1 });
    raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
      VALUES ('account-2', 'channel-2', '支店', 'token', 'secret', 'L2')`).run();
    raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following)
      VALUES ('friend-other', 'U-other', 'account-2', 1)`).run();
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U-other');
    const { app, env } = makeApp(db);
    expect(await book(app, env, 'foreign-account', 'L2')).toMatchObject({
      status: 409, body: { error: 'event_unpublished' },
    });
    expect(waitlistRows(raw)).toEqual([]);
    expect(bookingRows(raw)).toEqual([]);
    raw.close();
  });

  it('別アカウントの別イベントの予約は本人上限へ混ぜない', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 0, waitlist: 1 });
    raw.prepare(`UPDATE events SET max_bookings_per_friend = 1`).run();
    raw.prepare(`UPDATE friends SET user_id = 'shared-user' WHERE id = 'friend-1'`).run();
    raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-2', 'channel-2', '支店', 'token', 'secret')`).run();
    raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following, user_id)
      VALUES ('friend-other', 'U-other', 'account-2', 1, 'shared-user')`).run();
    raw.prepare(`INSERT INTO events (id, line_account_id, name, target_type, is_published)
      VALUES ('ev-other', 'account-2', '別の催し', 'single', 1)`).run();
    raw.prepare(`INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active)
      VALUES ('slot-other', 'ev-other', ?, ?, 1, 1)`).run(FUTURE, FUTURE);
    raw.prepare(`INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, requested_at)
      VALUES ('other-booking', 'account-2', 'ev-other', 'slot-other', 'friend-other',
              'uid:shared-user', 'confirmed', ?)`).run(FUTURE);
    const { app, env } = makeApp(db);
    expect(await book(app, env, 'separate-event')).toMatchObject({ status: 200, body: { waitlisted: true } });
    expect(waitlistRows(raw)).toEqual([{ friend_id: 'friend-1', status: 'waiting' }]);
    raw.close();
  });

  it('待ちが有効なら、負けた側も待ち行列へ入る', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    const { app, env } = makeApp(db);
    racingCallers();

    const [a, b] = await Promise.all([
      book(app, env, 'race-a'),
      book(app, env, 'race-b'),
    ]);

    // 片方だけが席を取る。
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    expect(bookingRows(raw)).toHaveLength(1);

    // 負けた側は 200 で「待ちに入った」と返る。409 で終わらせない。
    const loser = a.status === 200 ? a : b;
    expect(loser.body).toMatchObject({ waitlisted: true, slot_id: 'slot-1' });

    // 実際に待ち行列の行が増えている。勝った人は入らない。
    const waiting = waitlistRows(raw);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].status).toBe('waiting');
    expect(waiting[0].friend_id).not.toBe(bookingRows(raw)[0].friend_id);
  });

  it('待ちが無効なら、負けた側はこれまでどおり 409 で断る', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 0 });
    const { app, env } = makeApp(db);
    racingCallers();

    const [a, b] = await Promise.all([
      book(app, env, 'race-a'),
      book(app, env, 'race-b'),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ error: 'slot_full' });
    expect(waitlistRows(raw)).toEqual([]);
    expect(bookingRows(raw)).toHaveLength(1);
  });

  it('負けた側の予約行は残さない(席を二重に押さえない)', async () => {
    const { db, raw } = createTestD1();
    seed(raw, { capacity: 1, waitlist: 1 });
    const { app, env } = makeApp(db);
    racingCallers();

    await Promise.all([book(app, env, 'race-a'), book(app, env, 'race-b')]);

    const active = raw
      .prepare(
        `SELECT COALESCE(SUM(party_size), 0) AS seats FROM event_bookings
          WHERE slot_id = 'slot-1' AND status IN ('requested','confirmed')`,
      )
      .get() as { seats: number };
    expect(active.seats).toBe(1);
  });
});
