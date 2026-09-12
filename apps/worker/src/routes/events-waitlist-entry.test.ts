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

async function book(app: Hono<Env>, env: unknown, key: string) {
  const res = await app.request(
    '/api/liff/events/ev-1/bookings?liffId=L1',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': key,
        Authorization: 'Bearer t',
      },
      body: JSON.stringify({ slot_id: 'slot-1' }),
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

beforeEach(() => {
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U-friend-1');
});

describe('前から満席だった申込', () => {
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
