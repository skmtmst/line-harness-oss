/**
 * 予約リマインダー定期送信の同時実行と取消の食い違い (m22l)。
 * R330・R331 の回帰試験。実 SQLite で重なりと取消を再現する。
 */
import { beforeEach, describe, expect, test, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDueReminders } from './booking-reminders.js';

function asD1(sqlite: Database.Database): D1Database {
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...params) as T[], meta: {} }),
        first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: result.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  };
  return db as unknown as D1Database;
}

function seed(sqlite: Database.Database) {
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc1','c','A','tok','sec');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('f1','U1','T','acc1',1,'2026-01-01','2026-01-01');
    INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('s1','acc1','S','S');
    INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price, concurrent_capacity)
    VALUES ('m1','acc1','M',60,10,100,1);
    INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES ('s1','m1',1);
    INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at, status, price_at_booking, requested_at, lock_version, notification_policy_snapshot, source)
    VALUES ('B1','acc1','f1','s1','m1','2026-10-05T02:00:00.000Z','2026-10-05T03:00:00.000Z','2026-10-05T03:10:00.000Z','confirmed',100,'2026-01-01',0,'{}','liff');
    INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at, status, retry_count)
    VALUES ('R1','B1','day_before','2026-10-04T02:00:00.000Z','pending',0);
  `);
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('processDueReminders の同時実行と取消 (R330・R331)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    seed(sqlite);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  test('R330: 送信中に別の定期処理が始まっても送信は1回', async () => {
    const gate = deferred();
    let calls = 0;
    const sender = vi.fn(async () => {
      calls++;
      await gate.promise;
    });
    const now = new Date('2026-10-04T03:00:00.000Z');
    // cron A が送信応答待ちの間に cron B を始める。
    const first = processDueReminders(db, { now, sender } as never);
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = await processDueReminders(db, { now, sender: vi.fn(async () => { calls++; }) } as never);
    gate.resolve();
    const firstResult = await first;
    // B は貸出中の行を拾わない。A だけが送る。
    expect(firstResult).toEqual({ sent: 1, failed: 0 });
    expect(second).toEqual({ sent: 0, failed: 0 });
    expect(calls).toBe(1);
    const row = sqlite.prepare(`SELECT status, retry_count FROM booking_reminders WHERE id = 'R1'`).get() as {
      status: string; retry_count: number;
    };
    expect(row.status).toBe('sent');
    expect(row.retry_count).toBe(1);
  });

  test('R331: 通知OFFで止めた予定は送信中の失敗処理で復活しない', async () => {
    const gate = deferred();
    const sender = vi.fn(async () => {
      await gate.promise;
      throw new Error('sender failed');
    });
    const now = new Date('2026-10-04T03:00:00.000Z');
    const first = processDueReminders(db, { now, sender } as never);
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    // 送信待ちの間に通知OFF (予約変更 PATCH と同じ取消)。
    sqlite.prepare(`UPDATE booking_reminders SET status = 'cancelled' WHERE id = 'R1'`).run();
    gate.resolve();
    const firstResult = await first;
    // 先行の失敗処理は取消ずみを failed へ戻さない。
    expect(firstResult).toEqual({ sent: 0, failed: 0 });
    const row = sqlite.prepare(`SELECT status FROM booking_reminders WHERE id = 'R1'`).get() as { status: string };
    expect(row.status).toBe('cancelled');

    // 後続 cron も送らない。
    const spy = vi.fn(async () => {});
    const second = await processDueReminders(db, { now, sender: spy } as never);
    expect(second).toEqual({ sent: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('R331: 通知方針OFFの種別は送信前に止まる', async () => {
    sqlite.prepare(
      `UPDATE bookings SET notification_policy_snapshot = ? WHERE id = 'B1'`,
    ).run(JSON.stringify({ send_line_confirmation: true, day_before: false, hours_before: true }));
    const sender = vi.fn(async () => {});
    const res = await processDueReminders(db, { now: new Date('2026-10-04T03:00:00.000Z'), sender } as never);
    // day_before 行は方針で止まり、送信も失敗数も増えない。
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
    const row = sqlite.prepare(`SELECT status FROM booking_reminders WHERE id = 'R1'`).get() as { status: string };
    expect(row.status).toBe('pending');
  });
});
