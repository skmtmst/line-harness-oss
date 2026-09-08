/**
 * N-065追補 (#654) の回帰テスト。3点の部分失敗を本物に近い形で固定する。
 *
 * - 取消と送信claimの原子化: live確認と取消UPDATEの間に別接続からclaimが
 *   割り込むと、0件成功にせず REMINDER_SEND_IN_FLIGHT を投げる。
 * - Calendar台帳の初期DB失敗: 先行登録の失敗は落とさず、再送で回復する。
 *   行さえあればcronも拾える。
 * - event却下の再送: 待機者ジョブの再登録を受け付け、二重登録しない。
 *
 * 1ファイルで2接続 (route側と割込み/cron側) を同じDBファイルに張る。
 * 外部 LINE・Google へは送らない。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { cancelV6RemindersForSource } from '@line-crm/db';
import type { Env } from '../index.js';
import { processPendingCalendarDeleteOperations } from '../services/booking-calendar-sync.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const bookingCustomerMocks = vi.hoisted(() => ({
  createBookingCustomer: vi.fn(),
  getBookingCustomer: vi.fn(),
  searchBookingCustomers: vi.fn(),
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  ...bookingCustomerMocks,
}));

const availabilityMocks = { computeSlots: vi.fn(() => []) };
vi.mock('../services/availability.js', () => availabilityMocks);

const notifierMocks = { sendBookingNotification: vi.fn() };
vi.mock('../services/booking-notifier.js', () => notifierMocks);

const eventNotifierMocks = vi.hoisted(() => ({ sendEventBookingNotification: vi.fn(async () => {}) }));
vi.mock('../services/event-booking-notifier.js', () => eventNotifierMocks);

const { default: booking } = await import('./booking.js');
const { default: events } = await import('./events.js');

const BOOTSTRAP = readFileSync(
  join(process.cwd(), '../../packages/db/bootstrap.sql'),
  'utf8',
);

type Fault = (sql: string) => boolean;

/** 同じDBファイルへの2接続 (route側と割込み/cron側)。逐次に使う。 */
function openDualDb() {
  const dir = mkdtempSync(join(tmpdir(), 'n065-654-'));
  const file = join(dir, 'test.db');
  const raw1 = new Database(file);
  raw1.exec('PRAGMA journal_mode=WAL');
  raw1.exec(BOOTSTRAP);
  raw1.pragma('foreign_keys = OFF');
  const raw2 = new Database(file);
  raw2.pragma('foreign_keys = OFF');
  const wrap = (raw: Database.Database, fault?: Fault): D1Database => {
    const prepare = (sql: string): D1PreparedStatement => {
      const make = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => make(next),
        first: async <T>() => {
          if (fault?.(sql)) throw new Error('injected-db-failure');
          return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
        },
        all: async <T>() => {
          if (fault?.(sql)) throw new Error('injected-db-failure');
          return { results: raw.prepare(sql).all(...params) as T[], success: true, meta: {} };
        },
        run: async <T>() => {
          if (fault?.(sql)) throw new Error('injected-db-failure');
          const info = raw.prepare(sql).run(...params);
          return { success: true, results: [], meta: { changes: info.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return make([]);
    };
    return {
      prepare,
      batch: async <T>(statements: D1PreparedStatement[]) => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          raw.exec('COMMIT');
          return results as T;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
    } as unknown as D1Database;
  };
  return {
    db1: wrap(raw1),
    faultyDb1: (fault: Fault) => wrap(raw1, fault),
    db2: wrap(raw2),
    raw1,
    raw2,
    cleanup: () => {
      raw1.close();
      raw2.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedAccountsAndFriends(raw: Database.Database) {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc1','channel-1','A店','token','secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('f1','U1','花子','acc1',1,'2026-01-01T00:00:00.000','2026-01-01T00:00:00.000');
    INSERT INTO reminders
      (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
    VALUES ('rb-rule','rule','acc1',1,'booking','countdown','published');
    INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
    VALUES ('rb-step','rb-rule',-60,'text','ご来店をお待ちしています');
  `);
}

function seedDeliveryRun(
  raw: Database.Database,
  overrides: Record<string, string> = {},
) {
  const row: Record<string, string> = {
    id: 'RUN-1',
    line_account_id: 'acc1',
    reminder_id: 'rb-rule',
    friend_reminder_id: 'FR-1',
    friend_id: 'f1',
    reminder_step_id: 'rb-step',
    scheduled_at: '2026-09-20T00:00:00.000Z',
    idempotency_key: 'idem-1',
    line_retry_key: 'retry-1',
    status: 'claimed',
    lease_expires_at: '2099-01-01T00:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  const cols = Object.keys(row);
  raw.prepare(
    `INSERT INTO reminder_delivery_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...cols.map((c) => row[c]));
}

describe('取消と送信claimの原子化 (#654-1)', () => {
  it('確認後に別接続からclaimが割り込むと0件成功にせず投げる', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','B1');
      `);
      // live確認を通ってから、取消UPDATEの前に別接続が送信権を取る。
      // 旧実装はこの割込みで取消0件を成功扱いし、取消確定後の送信が起きた。
      const attempt = cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T00:00:00.000Z',
        failOnSendInFlight: true,
        beforeFlip: async () => {
          seedDeliveryRun(dual.raw2);
        },
      });
      await expect(attempt).rejects.toThrow('REMINDER_SEND_IN_FLIGHT');
      // 取消は確定していない (登録は active のまま。再試行が正当)。
      expect(dual.raw1.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-1'`,
      ).get()).toEqual({ status: 'active' });
      // 送信が終われば再試行で止まる。
      dual.raw1.prepare(
        `UPDATE reminder_delivery_runs SET status = 'succeeded', lease_expires_at = NULL WHERE id = 'RUN-1'`,
      ).run();
      const done = await cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T00:00:00.000Z',
        failOnSendInFlight: true,
      });
      expect(done.cancelledEnrollments).toBe(1);
      expect(dual.raw1.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-1'`,
      ).get()).toEqual({ status: 'cancelled' });
    } finally {
      dual.cleanup();
    }
  });

  it('対象が無い再送は投げず0件で返す (冪等)', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      const done = await cancelV6RemindersForSource(dual.db1, {
        sourceId: 'missing',
        sourceEventId: 'missing',
        cancelReason: 'test',
        now: '2026-09-10T00:00:00.000Z',
        failOnSendInFlight: true,
      });
      expect(done).toEqual({ cancelledEnrollments: 0, cancelledRuns: 0 });
    } finally {
      dual.cleanup();
    }
  });
});

function seedBookingCancelTarget(raw: Database.Database) {
  seedAccountsAndFriends(raw);
  raw.exec(`
    INSERT INTO staff (id, line_account_id, name, display_name)
    VALUES ('s1','acc1','担当A','担当A'), ('owner-1','acc1','Owner','Owner');
    INSERT INTO menus (
      id, line_account_id, name, duration_minutes, buffer_after_minutes,
      base_price, concurrent_capacity
    ) VALUES ('m1','acc1','相談',60,10,8000,1);
    INSERT INTO bookings (
      id, line_account_id, friend_id, staff_id, menu_id,
      starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at,
      external_event_id
    ) VALUES (
      'RB9','acc1','f1','s1','m1',
      '2026-09-20T01:00:00.000Z','2026-09-20T02:00:00.000Z','2026-09-20T02:00:00.000Z',
      'confirmed',8000,'2026-09-01T00:00:00.000Z', NULL
    ),
    (
      'RB10','acc1','f1','s1','m1',
      '2026-09-21T01:00:00.000Z','2026-09-21T02:00:00.000Z','2026-09-21T02:00:00.000Z',
      'confirmed',8000,'2026-09-01T00:00:00.000Z','gcal-ev-10'
    );
  `);
}

function makeBookingApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } };
}

describe('Calendar台帳の初期DB失敗の永続回復 (#654-2)', () => {
  it('先行登録の失敗は落とさず、取消再送で回復する', async () => {
    const dual = openDualDb();
    try {
      seedBookingCancelTarget(dual.raw1);
      // 台帳の作成だけ落とす初期DB失敗。1回だけ投げて止める。
      let failOnce = true;
      const faulty = dual.faultyDb1((sql) =>
        sql.includes('INTO booking_operation_runs') && failOnce
          ? (failOnce = false, true)
          : false,
      );
      const execCtx = {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext;
      const first = makeBookingApp(faulty);
      const failed = await first.app.request(
        '/api/booking/admin/requests/RB9?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        first.env,
        execCtx,
      );
      // 失敗は隠さない。予約は取消ずみだが、台帳行は無い。
      expect(failed.status).toBe(500);
      expect(dual.raw1.prepare(`SELECT status FROM bookings WHERE id = 'RB9'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM booking_operation_runs WHERE booking_id = 'RB9'`,
      ).get()).toEqual({ c: 0 });
      // 同じ取消要求の再送で台帳行が残り、終端まで進む (消す物が無いため skipped)。
      const second = makeBookingApp(dual.db1);
      const retried = await second.app.request(
        '/api/booking/admin/requests/RB9?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        second.env,
        execCtx,
      );
      expect(retried.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT status FROM booking_operation_runs WHERE booking_id = 'RB9'`,
      ).get()).toEqual({ status: 'skipped' });
    } finally {
      dual.cleanup();
    }
  });

  it('別接続のcronが先行登録ずみの行を拾って直す', async () => {
    const dual = openDualDb();
    try {
      seedBookingCancelTarget(dual.raw1);
      // route側の接続で先行登録 (取消の状態更新の直後に残る想定)。
      const { enqueueCalendarDeleteOperation } = await import(
        '../services/booking-calendar-sync.js'
      );
      await enqueueCalendarDeleteOperation(dual.db1, { bookingId: 'RB10', lineAccountId: 'acc1' });
      // cron側の別接続が回収する。外部削除は1回だけ。
      const removed: string[] = [];
      const drained = await processPendingCalendarDeleteOperations(dual.db2, {
        now: new Date('2026-09-10T00:00:00.000Z'),
        remove: async (bookingId) => {
          removed.push(bookingId);
        },
      });
      expect(drained).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });
      expect(removed).toEqual(['RB10']);
      // もう一度回しても触らない (終端行は拾わない)。
      const again = await processPendingCalendarDeleteOperations(dual.db2, {
        now: new Date('2026-09-10T00:00:01.000Z'),
        remove: async (bookingId) => {
          removed.push(bookingId);
        },
      });
      expect(again.processed).toBe(0);
      expect(removed).toEqual(['RB10']);
    } finally {
      dual.cleanup();
    }
  });
});

function seedEventRejectTarget(raw: Database.Database) {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1','channel-1','本店','token','secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('friend-1','U-friend-1','田中さくら','account-1',1);
    INSERT INTO events (id, line_account_id, name, target_type)
    VALUES ('ev-1','account-1','体験会','single');
    INSERT INTO event_slots (id, event_id, starts_at, ends_at)
    VALUES ('slot-1','ev-1','2026-09-20T01:00:00.000Z','2026-09-20T02:00:00.000Z');
    INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, status, requested_at,
       decided_at, decided_by_staff_id)
    VALUES ('eb-r1','account-1','ev-1','slot-1','friend-1','rejected','2026-09-01T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z','owner-1');
    INSERT INTO reminders
      (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
    VALUES ('rule-event-1','rule','account-1',1,'event','countdown','published');
    INSERT INTO reminder_steps
      (id, reminder_id, offset_minutes, message_type, message_content)
    VALUES ('step-rule-event-1','rule-event-1',-60,'text','お待ちしています');
  `);
}

function makeEventsApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', events);
  return { app, env: { DB: db } };
}

describe('event却下再送の待機者再登録 (#654-3)', () => {
  it('初回の待機者登録失敗は再送で直り、二重登録しない', async () => {
    const dual = openDualDb();
    try {
      seedEventRejectTarget(dual.raw1);
      const decide = (db: D1Database) => {
        const { app, env } = makeEventsApp(db);
        return app.request(
          '/api/events/admin/events/ev-1/bookings/eb-r1/decide?account_id=account-1',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reject' }),
          },
          env,
        );
      };
      // 初回の待機者ジョブ登録だけ落とすDB失敗。V6修復は通る。
      let failOnce = true;
      const faulty = dual.faultyDb1((sql) =>
        sql.includes('INSERT OR IGNORE INTO event_waitlist_promotion_jobs') && failOnce
          ? (failOnce = false, true)
          : false,
      );
      const failed = await decide(faulty);
      expect(failed.status).toBe(500);
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs WHERE source_key = 'booking:eb-r1:rejected'`,
      ).get()).toEqual({ c: 0 });
      // 同じ却下要求の再送で待機者ジョブが残る。
      const retried = await decide(dual.db1);
      expect(retried.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT status FROM event_waitlist_promotion_jobs WHERE source_key = 'booking:eb-r1:rejected'`,
      ).get()).toEqual({ status: 'pending' });
      // もう一度送っても1行のまま (二重登録なし)。
      const again = await decide(dual.db1);
      expect(again.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs WHERE source_key = 'booking:eb-r1:rejected'`,
      ).get()).toEqual({ c: 1 });
    } finally {
      dual.cleanup();
    }
  });
});
