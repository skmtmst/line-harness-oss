/**
 * N-065追補 (#654) の回帰テスト。3点の部分失敗を本物に近い形で固定する。
 *
 * - 取消と送信claimの原子化: live確認後に別接続で実claim・最終verifyが
 *   割り込んでも、取消を成功させず送信権を守る。
 * - Calendar台帳の初期DB失敗: 先行登録の失敗は落とさず、再送で回復する。
 *   行さえあればcronも拾える。
 * - event却下・管理者取消の再送: 待機者ジョブを復旧し、二重登録しない。
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

import {
  cancelV6RemindersForSource,
  claimReminderDeliveryRun,
  verifyClaimedRunBeforeSend,
} from '@line-crm/db';
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

const liffAuthMocks = vi.hoisted(() => ({ verifyCallerLineUserId: vi.fn(async () => 'U9') }));
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

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
  overrides: Record<string, string | null> = {},
) {
  const row: Record<string, string | null> = {
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
  it('実claim→最終verify後の取消割込みは409相当で拒否し、push権を守る', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','B1');
      `);
      const pushMessageWithRequestId = vi.fn(async (..._args: unknown[]) => ({ requestId: 'REQ-1' }));
      let finalVerifyPassed = false;
      // 取消側が対象選択・live COUNT=0を済ませた後に、別接続の
      // 実配信プロトコルで claim と最終verifyを通す。取消がここから
      // 成功すると、その後のLINE pushが「取消確定後の送信」になる。
      const cancellation = cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T00:00:00.000Z',
        failOnSendInFlight: true,
        beforeFlip: async () => {
          const run = await claimReminderDeliveryRun(dual.db2, {
            lineAccountId: 'acc1',
            reminderId: 'rb-rule',
            friendReminderId: 'FR-1',
            friendId: 'f1',
            reminderStepId: 'rb-step',
            scheduledAt: '2026-09-09T23:00:00.000Z',
            now: '2026-09-10T00:00:00.000Z',
            leaseExpiresAt: '2026-09-10T00:05:00.000Z',
          });
          expect(run).not.toBeNull();
          finalVerifyPassed = await verifyClaimedRunBeforeSend(dual.db2, {
            id: run!.id,
            friendReminderId: 'FR-1',
            now: '2026-09-10T00:00:00.000Z',
            leaseExpiresAt: '2026-09-10T00:05:00.000Z',
          });
        },
      });
      await expect(cancellation).rejects.toThrow('REMINDER_SEND_IN_FLIGHT');
      expect(finalVerifyPassed).toBe(true);
      // 取消が拒否された後だけ、最終verify済みの送信権を使える。
      await pushMessageWithRequestId('U1', [{ type: 'text', text: 'ご来店をお待ちしています' }], 'retry-1');
      expect(pushMessageWithRequestId).toHaveBeenCalledOnce();
      expect(dual.raw1.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-1'`,
      ).get()).toEqual({ status: 'active' });
      expect(dual.raw1.prepare(
        `SELECT status FROM reminder_delivery_runs WHERE friend_reminder_id = 'FR-1'`,
      ).get()).toEqual({ status: 'claimed' });
    } finally {
      dual.cleanup();
    }
  });

  it('複数登録の1件割込みは成功にせず投げる (部分残留)', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','EV-a'),
               ('FR-2','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','EV-b');
      `);
      // 1件だけに割込みclaimが入る。旧実装は行単位の除外で割込み行だけ残し、
      // 1件止まった成功で残るactive+claimedを抱えたまま成功した。
      // 新実装は取消の一部確定を戻し、両方activeのまま再試行させる。
      const cancellation = cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T00:00:00.000Z',
        failOnSendInFlight: true,
        beforeFlip: async () => {
          seedDeliveryRun(dual.raw2, { id: 'RUN-2', friend_reminder_id: 'FR-2' });
        },
      });
      await expect(cancellation).rejects.toThrow('REMINDER_SEND_IN_FLIGHT');
      expect(dual.raw1.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-1'`,
      ).get()).toEqual({ status: 'active' });
      expect(dual.raw1.prepare(
        `SELECT status FROM friend_reminders WHERE id = 'FR-2'`,
      ).get()).toEqual({ status: 'active' });
      expect(dual.raw1.prepare(
        `SELECT status FROM reminder_delivery_runs WHERE id = 'RUN-2'`,
      ).get()).toEqual({ status: 'claimed' });
    } finally {
      dual.cleanup();
    }
  });

  it('UTC Zのleaseと+09:00のnowをepochで比べる (TEXT比較の見逃し)', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','B1');
      `);
      // 実時間で10分live (Z)。nowは+09:00書き。TEXT比較だと 'T04'<'T13' で
      // 見逃して取消成功する欠陥だった。epoch比較では投げる。
      seedDeliveryRun(dual.raw1, { lease_expires_at: '2026-09-10T04:10:00.000Z' });
      const live = cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T13:00:00.000+09:00',
        failOnSendInFlight: true,
      });
      await expect(live).rejects.toThrow('REMINDER_SEND_IN_FLIGHT');
      // 実時間で切れている lease は止める (TEXTでもepochでも同じ結論)。
      dual.raw1.prepare(
        `UPDATE reminder_delivery_runs SET lease_expires_at = '2026-09-10T03:50:00.000Z' WHERE id = 'RUN-1'`,
      ).run();
      const done = await cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T13:00:00.000+09:00',
        failOnSendInFlight: true,
      });
      expect(done.cancelledEnrollments).toBe(1);
    } finally {
      dual.cleanup();
    }
  });

  it('本番既定now (+09:00) でも実時間liveを見逃さない', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','B1');
      `);
      // nowを渡さない (本番と同じ既定: +09:00書きの現在時刻)。
      seedDeliveryRun(dual.raw1, {
        lease_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      const live = cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        failOnSendInFlight: true,
      });
      await expect(live).rejects.toThrow('REMINDER_SEND_IN_FLIGHT');
    } finally {
      dual.cleanup();
    }
  });

  it('retry_wait・切れleaseの交差は止め切って成功する', async () => {
    const dual = openDualDb();
    try {
      seedAccountsAndFriends(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-1','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','B1','B1');
      `);
      // 再試行待ちと、切れた貸出の残り。liveは無い。
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-rw', status: 'retry_wait', lease_expires_at: null,
        next_retry_at: '2026-09-10T01:00:00.000Z',
      });
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-old', lease_expires_at: '2020-01-01T00:00:00.000Z',
        scheduled_at: '2026-09-20T01:00:00.000Z',
        line_retry_key: 'retry-old', idempotency_key: 'idem-old',
        reminder_step_id: 'rb-step-2',
      });
      const done = await cancelV6RemindersForSource(dual.db1, {
        sourceId: 'B1',
        sourceEventId: 'B1',
        cancelReason: 'test',
        now: '2026-09-10T13:00:00.000+09:00',
        failOnSendInFlight: true,
      });
      expect(done.cancelledEnrollments).toBe(1);
      expect(done.cancelledRuns).toBe(2);
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
  it('fence成功後の登録の失敗は落とさず、取消再送で回復する', async () => {
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

  it('連続DB失敗でも台帳なし200にせず、回復する', async () => {
    const dual = openDualDb();
    try {
      seedBookingCancelTarget(dual.raw1);
      // 台帳の作成を2回連続で落とす。3回目で通る。
      let failuresLeft = 2;
      const faulty = dual.faultyDb1((sql) =>
        sql.includes('INTO booking_operation_runs') && failuresLeft > 0
          ? (failuresLeft--, true)
          : false,
      );
      const execCtx = {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext;
      const send = (db: D1Database) => {
        const { app, env } = makeBookingApp(db);
        return app.request(
          '/api/booking/admin/requests/RB9?account_id=acc1',
          {
            method: 'PATCH',
            body: JSON.stringify({ action: 'cancel' }),
            headers: { 'Content-Type': 'application/json' },
          },
          env,
          execCtx,
        );
      };
      // 初回 (本線): 500。2回目の再送も 500。台帳なしの成功応答はしない。
      expect((await send(faulty)).status).toBe(500);
      expect((await send(faulty)).status).toBe(500);
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM booking_operation_runs WHERE booking_id = 'RB9'`,
      ).get()).toEqual({ c: 0 });
      // 3回目で回復する。
      const recovered = await send(dual.db1);
      expect(recovered.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT status FROM booking_operation_runs WHERE booking_id = 'RB9'`,
      ).get()).toEqual({ status: 'skipped' });
    } finally {
      dual.cleanup();
    }
  });

  it('本番既定nowの実routeでもlive見逃しで取消成功しない', async () => {
    const dual = openDualDb();
    try {
      seedBookingCancelTarget(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-9','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','RB9','RB9');
      `);
      // 実時間でliveなZ lease。routeは既定now (+09:00書き) で比べる。
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-9',
        friend_reminder_id: 'FR-9',
        lease_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      const execCtx = {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext;
      const { app, env } = makeBookingApp(dual.db1);
      const conflicted = await app.request(
        '/api/booking/admin/requests/RB9?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );
      // TEXT比較の旧実装は見逃して200取消成功する欠陥だった。
      expect(conflicted.status).toBe(409);
      expect(dual.raw1.prepare(`SELECT status FROM bookings WHERE id = 'RB9'`).get()).toEqual({
        status: 'confirmed',
      });
    } finally {
      dual.cleanup();
    }
  });

  it('409で巻き戻した確定予約の予定をcronが消さない', async () => {
    const dual = openDualDb();
    try {
      seedBookingCancelTarget(dual.raw1);
      dual.raw1.exec(`
        INSERT INTO friend_reminders
          (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
        VALUES ('FR-9','f1','rb-rule','2026-09-20T01:00:00.000Z','active','booking','RB9','RB9');
      `);
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-9', friend_reminder_id: 'FR-9', reminder_step_id: 'rb-step',
      });
      const execCtx = {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext;
      const { app, env } = makeBookingApp(dual.db1);
      // 貸出中は巻き戻して409。台帳行は残さない (fence成功後に移した)。
      const conflicted = await app.request(
        '/api/booking/admin/requests/RB9?account_id=acc1',
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );
      expect(conflicted.status).toBe(409);
      expect(dual.raw1.prepare(`SELECT status FROM bookings WHERE id = 'RB9'`).get()).toEqual({
        status: 'confirmed',
      });
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM booking_operation_runs WHERE booking_id = 'RB9'`,
      ).get()).toEqual({ c: 0 });
      // 残留した古い queued 行があっても、確定ずみの予定は消さない。
      const { enqueueCalendarDeleteOperation } = await import(
        '../services/booking-calendar-sync.js'
      );
      await enqueueCalendarDeleteOperation(dual.db1, { bookingId: 'RB9', lineAccountId: 'acc1' });
      const removed: string[] = [];
      const drained = await processPendingCalendarDeleteOperations(dual.db2, {
        now: new Date('2026-09-10T00:00:00.000Z'),
        remove: async (bookingId) => {
          removed.push(bookingId);
        },
      });
      expect(removed).toEqual([]);
      expect(drained).toEqual({ processed: 1, succeeded: 0, retrying: 0, skipped: 1 });
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
      // fence成功後の取消ずみ予約を想定する (実行側は取消ずみだけ消す)。
      dual.raw1.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = 'RB10'`).run();
      // route側の接続で登録 (V6 fence成功後に残る想定)。
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

function seedLiffCancelTarget(raw: Database.Database) {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id, is_active)
    VALUES ('account-9','channel-9','9店','token9','secret9','L9',1);
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('friend-9','U9','本人','account-9',1);
    INSERT INTO events (id, line_account_id, name, target_type, cancel_deadline_hours_before)
    VALUES ('ev-9','account-9','体験会','single',24);
    INSERT INTO event_slots (id, event_id, starts_at, ends_at)
    VALUES ('slot-9','ev-9','2099-06-01T10:00:00.000Z','2099-06-01T12:00:00.000Z');
    INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
    VALUES ('eb-l1','account-9','ev-9','slot-9','friend-9','requested','2026-09-01T00:00:00.000Z');
    INSERT INTO reminders
      (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
    VALUES ('rule-event-9','rule','account-9',1,'event','countdown','published');
    INSERT INTO reminder_steps
      (id, reminder_id, offset_minutes, message_type, message_content)
    VALUES ('step-rule-event-9','rule-event-9',-60,'text','お待ちしています');
    INSERT INTO friend_reminders
      (id, friend_id, reminder_id, target_date, status, source_kind, source_id, source_event_id)
    VALUES ('FR-l1','friend-9','rule-event-9','2099-06-01T10:00:00.000Z','active','event','eb-l1','eb-l1');
    INSERT INTO event_booking_reminders
      (id, booking_id, kind, scheduled_at, status, retry_count)
    VALUES ('LEG-l1','eb-l1','day_before','2099-05-31T10:00:00.000Z','pending',0);
  `);
}

describe('管理者イベント取消の待機者再登録 (再審査-3)', () => {
  it('初回のenqueue失敗を同じ取消要求の再送で復旧する', async () => {
    const dual = openDualDb();
    try {
      seedLiffCancelTarget(dual.raw1);
      const cancel = (db: D1Database) => {
        const { app, env } = makeEventsApp(db);
        return app.request(
          '/api/events/admin/events/ev-9/bookings/eb-l1/cancel?account_id=account-9',
          { method: 'POST' },
          env,
        );
      };
      let failOnce = true;
      const faulty = dual.faultyDb1((sql) =>
        sql.includes('INSERT OR IGNORE INTO event_waitlist_promotion_jobs') && failOnce
          ? (failOnce = false, true)
          : false,
      );

      const failed = await cancel(faulty);
      expect(failed.status).toBe(500);
      expect(dual.raw1.prepare(
        `SELECT status FROM event_bookings WHERE id = 'eb-l1'`,
      ).get()).toEqual({ status: 'cancelled' });
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs
          WHERE source_key = 'booking:eb-l1:cancelled'`,
      ).get()).toEqual({ c: 0 });

      const retried = await cancel(dual.db1);
      expect(retried.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT status FROM event_waitlist_promotion_jobs
          WHERE source_key = 'booking:eb-l1:cancelled'`,
      ).get()).toEqual({ status: 'pending' });

      expect((await cancel(dual.db1)).status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs
          WHERE source_key = 'booking:eb-l1:cancelled'`,
      ).get()).toEqual({ c: 1 });
    } finally {
      dual.cleanup();
    }
  });
});

describe('LIFF本人取消の両分岐strict fence (再審査-2)', () => {
  it('初回も再送も貸出中は409で巻き戻し、再試行で取消せる', async () => {
    const dual = openDualDb();
    try {
      seedLiffCancelTarget(dual.raw1);
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-l1',
        line_account_id: 'account-9',
        reminder_id: 'rule-event-9',
        friend_reminder_id: 'FR-l1',
        friend_id: 'friend-9',
        reminder_step_id: 'step-rule-event-9',
        scheduled_at: '2099-06-01T09:00:00.000Z',
      });
      const cancel = (db: D1Database) => {
        const { app, env } = makeEventsApp(db);
        return app.request('/api/liff/events/me/eb-l1/cancel?liffId=L9', {
          method: 'POST',
          headers: { Authorization: 'Bearer test' },
        }, env);
      };
      // 初回: 貸出中は取消を確定させず 409。状態・旧表とも巻き戻る (完全rollback)。
      const conflicted = await cancel(dual.db1);
      expect(conflicted.status).toBe(409);
      expect(dual.raw1.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-l1'`).get()).toEqual({
        status: 'requested',
      });
      expect(dual.raw1.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR-l1'`).get()).toEqual({
        status: 'active',
      });
      expect(dual.raw1.prepare(`SELECT status FROM event_booking_reminders WHERE id = 'LEG-l1'`).get()).toEqual({
        status: 'pending',
      });
      // 送信が終われば再試行で取消せる。待機者ジョブも残る。
      dual.raw1.prepare(
        `UPDATE reminder_delivery_runs SET status = 'succeeded', lease_expires_at = NULL WHERE id = 'RUN-l1'`,
      ).run();
      const retried = await cancel(dual.db1);
      expect(retried.status).toBe(200);
      expect(dual.raw1.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-l1'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(dual.raw1.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR-l1'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(dual.raw1.prepare(`SELECT status FROM event_booking_reminders WHERE id = 'LEG-l1'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs WHERE source_key = 'booking:eb-l1:cancelled'`,
      ).get()).toEqual({ c: 1 });
      // 再送: V6も待機者も冪等 (二重登録なし)。
      const again = await cancel(dual.db1);
      expect(again.status).toBe(200);
      expect(dual.raw1.prepare(
        `SELECT COUNT(*) AS c FROM event_waitlist_promotion_jobs WHERE source_key = 'booking:eb-l1:cancelled'`,
      ).get()).toEqual({ c: 1 });
    } finally {
      dual.cleanup();
    }
  });

  it('再送の貸出中も409にし、状態を変えない', async () => {
    const dual = openDualDb();
    try {
      seedLiffCancelTarget(dual.raw1);
      // 取消ずみ・V6未処理の残り (初回の V6 失敗相当) + 新しい貸出。
      dual.raw1.prepare(`UPDATE event_bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'friend' WHERE id = 'eb-l1'`)
        .run('2026-09-02T00:00:00.000Z');
      seedDeliveryRun(dual.raw1, {
        id: 'RUN-l2',
        line_account_id: 'account-9',
        reminder_id: 'rule-event-9',
        friend_reminder_id: 'FR-l1',
        friend_id: 'friend-9',
        reminder_step_id: 'step-rule-event-9',
        scheduled_at: '2099-06-01T09:00:00.000Z',
      });
      const cancel = (db: D1Database) => {
        const { app, env } = makeEventsApp(db);
        return app.request('/api/liff/events/me/eb-l1/cancel?liffId=L9', {
          method: 'POST',
          headers: { Authorization: 'Bearer test' },
        }, env);
      };
      const conflicted = await cancel(dual.db1);
      expect(conflicted.status).toBe(409);
      expect(dual.raw1.prepare(`SELECT status FROM event_bookings WHERE id = 'eb-l1'`).get()).toEqual({
        status: 'cancelled',
      });
      expect(dual.raw1.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR-l1'`).get()).toEqual({
        status: 'active',
      });
      dual.raw1.prepare(
        `UPDATE reminder_delivery_runs SET status = 'succeeded', lease_expires_at = NULL WHERE id = 'RUN-l2'`,
      ).run();
      const retried = await cancel(dual.db1);
      expect(retried.status).toBe(200);
      expect(dual.raw1.prepare(`SELECT status FROM friend_reminders WHERE id = 'FR-l1'`).get()).toEqual({
        status: 'cancelled',
      });
    } finally {
      dual.cleanup();
    }
  });
});
