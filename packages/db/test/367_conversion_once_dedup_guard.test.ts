import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyConversionTestSchema } from './conversion-test-schema.js';
import {
  canRecordConversion,
  createConversionPoint,
  hasConversionPointActivity,
  resolveDedupPolicy,
  stopConversionPoint,
  trackConversion,
  updateConversionPoint,
} from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const MIGRATION_367 = readFileSync(
  join(MIGRATIONS_DIR, '367_conversion_once_dedup_guard.sql'),
  'utf8',
);

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

/** 367号だけを当てる最小構成。既存履歴を消さず止まらないことを見る。 */
function setupMinimal(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    INSERT INTO friends (id) VALUES ('c'), ('b|c'), ('friend-a'), ('friend-x'), ('friend-w');
    CREATE TABLE conversion_points (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL,
      count_repeat INTEGER NOT NULL DEFAULT 1,
      deduplication_mode TEXT NOT NULL DEFAULT 'every',
      deduplication_window_days INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE conversion_events (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL,
      friend_id TEXT NOT NULL, approval_status TEXT, created_at TEXT NOT NULL
    );
  `);
  return db;
}

/** 挙動試験用の軽量構成。全migration適用の代わりに必要最小の表だけ用意する。 */
function setupFull(): Database.Database {
  const db = new Database(':memory:');
  applyConversionTestSchema(db);
  return db;
}

function countEvents(db: Database.Database, pointId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id = ?',
  ).get(pointId) as { n: number };
  return row.n;
}

/** better-sqlite3 v12 は外部キーを強制するため、成果の親(友だち)を先に入れる。 */
function insertFriend(db: Database.Database, id: string, lineAccountId: string | null = null): void {
  db.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
     VALUES (?, ?, 'Test User', ?, '2024-01-01T00:00:00.000+09:00', '2024-01-01T00:00:00.000+09:00')`,
  ).run(id, `U${id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32)}`, lineAccountId);
}

function insertLineAccount(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, 'Test Account', 'token', 'secret')`,
  ).run(id, `channel-${id}`);
}

describe('367号 migration: 既存履歴を消さずに鍵付けする', () => {
  it('区切り文字を含むIDの別組を衝突させない', () => {
    const db = setupMinimal();
    db.exec(`
      INSERT INTO conversion_points (id, name, event_type, count_repeat, deduplication_mode, created_at)
      VALUES
        ('a|b', '地点1', 'purchase', 0, 'once_per_friend', '2026-08-01'),
        ('a', '地点2', 'purchase', 0, 'once_per_friend', '2026-08-01');
      INSERT INTO conversion_events (id, conversion_point_id, friend_id, approval_status, created_at)
      VALUES
        ('event-1', 'a|b', 'c', 'approved', '2026-08-02'),
        ('event-2', 'a', 'b|c', 'approved', '2026-08-02');
    `);

    expect(() => execSafe(db, MIGRATION_367)).not.toThrow();
    const claims = db.prepare(`SELECT conversion_point_id, friend_id
      FROM conversion_event_dedup_claims ORDER BY conversion_point_id, friend_id`).all();
    expect(claims).toEqual([
      { conversion_point_id: 'a', friend_id: 'b|c' },
      { conversion_point_id: 'a|b', friend_id: 'c' },
    ]);
  });

  it('途中適用で止まった状態から同じmigrationをそのまま再実行できる', () => {
    const db = setupMinimal();
    db.exec(`
      INSERT INTO conversion_points (id, name, event_type, count_repeat, deduplication_mode, created_at)
      VALUES ('point-once', '購入完了', 'purchase', 0, 'once_per_friend', '2026-08-01');
      INSERT INTO conversion_events (id, conversion_point_id, friend_id, approval_status, created_at)
      VALUES ('event-1', 'point-once', 'friend-a', 'approved', '2026-08-02');
    `);
    const statements = MIGRATION_367
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    // 実runnerと同じく1文ずつ進め、CREATE後に空欄claimが残った途中停止を作る。
    for (const statement of statements.slice(0, 3)) db.exec(statement);
    db.prepare(`INSERT INTO conversion_event_dedup_claims
      (conversion_point_id, friend_id, mode, window_days, last_event_id, last_at, updated_at)
      VALUES ('point-once', 'friend-a', 'lifetime', NULL, '', '', '2026-08-03')`).run();
    expect(() => {
      for (const statement of statements) db.exec(statement);
    }).not.toThrow();
    expect(db.prepare(`SELECT last_event_id, last_at FROM conversion_event_dedup_claims
      WHERE conversion_point_id = 'point-once' AND friend_id = 'friend-a'`).get())
      .toEqual({ last_event_id: 'event-1', last_at: '2026-08-02' });
  });

  it('重複があっても止まらず、勝者だけに鍵を付けて敗者は履歴として残す', () => {
    const db = setupMinimal();
    db.exec(`
      INSERT INTO conversion_points
        (id, name, event_type, count_repeat, deduplication_mode, deduplication_window_days, created_at)
      VALUES
        ('point-once', '購入完了', 'purchase', 0, 'once_per_friend', NULL, '2026-08-01'),
        ('point-repeat', '来店', 'visit', 1, 'every', NULL, '2026-08-01'),
        ('point-window', '月次利用', 'monthly', 0, 'window', 30, '2026-08-01');
      INSERT INTO conversion_events (id, conversion_point_id, friend_id, approval_status, created_at)
      VALUES
        ('event-first-pending', 'point-once', 'friend-a', 'pending', '2026-08-02'),
        ('event-later-approved', 'point-once', 'friend-a', 'approved', '2026-08-03'),
        ('event-repeat-ok-1', 'point-repeat', 'friend-x', NULL, '2026-08-02'),
        ('event-repeat-ok-2', 'point-repeat', 'friend-x', NULL, '2026-08-03'),
        ('event-window-old', 'point-window', 'friend-w', NULL, '2026-07-01');
    `);
    expect(() => execSafe(db, MIGRATION_367)).not.toThrow();
    expect(countEvents(db, 'point-once')).toBe(2);
    expect(countEvents(db, 'point-repeat')).toBe(2);
    expect(countEvents(db, 'point-window')).toBe(1);
    expect(db.prepare(`SELECT mode, window_days, last_event_id FROM conversion_event_dedup_claims
      WHERE conversion_point_id = 'point-once' AND friend_id = 'friend-a'`).get())
      .toEqual({ mode: 'lifetime', window_days: null, last_event_id: 'event-later-approved' });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM conversion_event_dedup_claims
      WHERE conversion_point_id = 'point-repeat'`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT mode, last_event_id FROM conversion_event_dedup_claims
      WHERE conversion_point_id = 'point-window' AND friend_id = 'friend-w'`).get())
      .toEqual({ mode: 'window', last_event_id: 'event-window-old' });
  });

  it('同じ地点・友だちのclaimは複合主キーで1件だけ', () => {
    const db = setupMinimal();
    db.exec(`
      INSERT INTO conversion_points (id, name, event_type, count_repeat, deduplication_mode, created_at)
      VALUES ('point-once', '購入完了', 'purchase', 0, 'once_per_friend', '2026-08-01');
    `);
    execSafe(db, MIGRATION_367);
    db.prepare(
      `INSERT INTO conversion_event_dedup_claims
       (conversion_point_id, friend_id, mode, last_event_id, last_at, updated_at)
       VALUES ('point-once', 'friend-a', 'lifetime', 'e1', '2026-08-02', '2026-08-02')`,
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO conversion_event_dedup_claims
         (conversion_point_id, friend_id, mode, last_event_id, last_at, updated_at)
         VALUES ('point-once', 'friend-a', 'lifetime', 'e2', '2026-08-02', '2026-08-02')`,
      ).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('精算の子行があっても外部キーで止まらない', () => {
    const db = setupMinimal();
    db.exec(`
      CREATE TABLE affiliate_reward_entries (
        id TEXT PRIMARY KEY,
        conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id)
      );
      INSERT INTO conversion_points (id, name, event_type, count_repeat, deduplication_mode, created_at)
      VALUES ('point-once', '購入完了', 'purchase', 0, 'once_per_friend', '2026-08-01');
      INSERT INTO conversion_events (id, conversion_point_id, friend_id, approval_status, created_at)
      VALUES
        ('event-old', 'point-once', 'friend-a', 'pending', '2026-08-02'),
        ('event-approved', 'point-once', 'friend-a', 'approved', '2026-08-03');
      INSERT INTO affiliate_reward_entries (id, conversion_event_id)
      VALUES ('reward-1', 'event-old');
    `);
    db.pragma('foreign_keys = ON');
    expect(() => execSafe(db, MIGRATION_367)).not.toThrow();
    // 両行とも残り、claimだけが勝者を指す。精算の参照も壊れない。
    expect(countEvents(db, 'point-once')).toBe(2);
    expect(db.prepare(`SELECT last_event_id FROM conversion_event_dedup_claims
      WHERE conversion_point_id = 'point-once' AND friend_id = 'friend-a'`).get())
      .toEqual({ last_event_id: 'event-approved' });
    expect(db.prepare(`SELECT conversion_event_id FROM affiliate_reward_entries WHERE id = 'reward-1'`).get())
      .toEqual({ conversion_event_id: 'event-old' });
  });
});

describe('N-255 同時重複計上と冪等キー', () => {
  it('同じ元イベントの同時到着は1件だけ計上する', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, {
      name: '購入完了', eventType: 'purchase', countRepeat: false,
    });
    insertFriend(db, 'friend-a');
    const [first, second] = await Promise.all([
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
    ]);
    expect(first.id).toBe(second.id);
    expect(countEvents(db, point.id)).toBe(1);
  });

  it('2回目の保存は最初の1件を返し増やさない', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, {
      name: '購入完了', eventType: 'purchase', countRepeat: false,
    });
    insertFriend(db, 'friend-a');
    const first = await trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' });
    const second = await trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' });
    expect(second.id).toBe(first.id);
    expect(countEvents(db, point.id)).toBe(1);
  });

  it('同じ冪等キー・同じ内容の再送は同じ結果を返す', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    insertFriend(db, 'friend-a');
    insertFriend(db, 'friend-b');
    const input = {
      conversionPointId: point.id, friendId: 'friend-a', metadata: '{"via":"web"}', idempotencyKey: 'order-1',
    };
    const first = await trackConversion(d1, input);
    const second = await trackConversion(d1, input);
    expect(second.id).toBe(first.id);
    expect(countEvents(db, point.id)).toBe(1);
  });

  it('同じ冪等キーの別内容の使い回しは409相当で弾き行を増やさない', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    insertFriend(db, 'friend-a');
    insertFriend(db, 'friend-b');
    await trackConversion(d1, {
      conversionPointId: point.id, friendId: 'friend-a', metadata: '{"via":"web"}', idempotencyKey: 'order-1',
    });
    await expect(trackConversion(d1, {
      conversionPointId: point.id, friendId: 'friend-b', metadata: '{"via":"web"}', idempotencyKey: 'order-1',
    })).rejects.toThrow('conversion_idempotency_key_conflict');
    expect(countEvents(db, point.id)).toBe(1);
  });

  it('繰返し数える地点は同時到着も複数計上する', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '来店', eventType: 'visit' });
    insertFriend(db, 'friend-a');
    const [first, second] = await Promise.all([
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
    ]);
    expect(first.id).not.toBe(second.id);
    expect(countEvents(db, point.id)).toBe(2);
  });

  it('実D1相当の複数接続でも同時到着は1件だけ計上する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-367-'));
    const path = join(dir, 'shared.db');
    const setup = new Database(path);
    setup.pragma('journal_mode = WAL');
    applyConversionTestSchema(setup);
    setup.close();
    // D1 は書込みを直列化するため、WAL + 待機で同じ条件にする。
    // 待機は異常時の保険で、通常は競合せず即終わる。
    const connA = new Database(path, { timeout: 3000 });
    const connB = new Database(path, { timeout: 3000 });
    try {
      const d1a = asD1(connA);
      const point = await createConversionPoint(d1a, {
        name: '購入完了', eventType: 'purchase', countRepeat: false,
      });
      insertFriend(connA, 'friend-a');
      const d1b = asD1(connB);
      const [first, second] = await Promise.all([
        trackConversion(d1a, { conversionPointId: point.id, friendId: 'friend-a' }),
        trackConversion(d1b, { conversionPointId: point.id, friendId: 'friend-a' }),
      ]);
      expect(first.id).toBe(second.id);
      expect(countEvents(connA, point.id)).toBe(1);
    } finally {
      connA.close();
      connB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('数え方の区別(lifetime/window/every)', () => {
  it('方針の判定は定義作成時の対応と一致する', () => {
    expect(resolveDedupPolicy({ count_repeat: 1, deduplication_mode: 'every', deduplication_window_days: null }))
      .toEqual({ kind: 'every' });
    expect(resolveDedupPolicy({ count_repeat: 0, deduplication_mode: 'every', deduplication_window_days: null }))
      .toEqual({ kind: 'lifetime' });
    expect(resolveDedupPolicy({ count_repeat: 0, deduplication_mode: 'once_per_friend', deduplication_window_days: null }))
      .toEqual({ kind: 'lifetime' });
    expect(resolveDedupPolicy({ count_repeat: 0, deduplication_mode: 'window', deduplication_window_days: 30 }))
      .toEqual({ kind: 'window', windowDays: 30 });
    // 期間の決まっていない窓は厳しい側に倒す。
    expect(resolveDedupPolicy({ count_repeat: 0, deduplication_mode: 'window', deduplication_window_days: null }))
      .toEqual({ kind: 'lifetime' });
  });

  it('windowは期間内だけ1件にし期間外は新しく数える', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    insertFriend(db, 'friend-a');
    const point = await createConversionPoint(d1, { name: '月次利用', eventType: 'monthly' });
    db.prepare(`UPDATE conversion_points SET deduplication_mode = 'window', deduplication_window_days = 30 WHERE id = ?`)
      .run(point.id);
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    const first = await trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }, { now: start });
    const second = await trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }, { now: start + 10 });
    expect(second.id).toBe(first.id);
    expect(countEvents(db, point.id)).toBe(1);
    const third = await trackConversion(
      d1,
      { conversionPointId: point.id, friendId: 'friend-a' },
      { now: start + 40 * 86_400_000 },
    );
    expect(third.id).not.toBe(first.id);
    expect(countEvents(db, point.id)).toBe(2);
  });

  it('windowの境界の同時到着は1件だけ計上する', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    insertFriend(db, 'friend-a');
    const point = await createConversionPoint(d1, { name: '月次利用', eventType: 'monthly' });
    db.prepare(`UPDATE conversion_points SET deduplication_mode = 'window', deduplication_window_days = 30 WHERE id = ?`)
      .run(point.id);
    const [first, second] = await Promise.all([
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
      trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' }),
    ]);
    expect(first.id).toBe(second.id);
    expect(countEvents(db, point.id)).toBe(1);
    expect(db.prepare(`SELECT last_event_id FROM conversion_event_dedup_claims
      WHERE conversion_point_id = ? AND friend_id = 'friend-a'`).get(point.id))
      .toEqual({ last_event_id: first.id });
  });

  it('windowの複数接続の同時到着も1件だけ計上する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-367-win-'));
    const path = join(dir, 'shared.db');
    const setup = new Database(path);
    setup.pragma('journal_mode = WAL');
    applyConversionTestSchema(setup);
    setup.close();
    const connA = new Database(path, { timeout: 3000 });
    const connB = new Database(path, { timeout: 3000 });
    try {
      insertFriend(connA, 'friend-a');
      const d1a = asD1(connA);
      const point = await createConversionPoint(d1a, { name: '月次利用', eventType: 'monthly' });
      connA.prepare(`UPDATE conversion_points SET deduplication_mode = 'window', deduplication_window_days = 30 WHERE id = ?`)
        .run(point.id);
      const d1b = asD1(connB);
      const [first, second] = await Promise.all([
        trackConversion(d1a, { conversionPointId: point.id, friendId: 'friend-a' }),
        trackConversion(d1b, { conversionPointId: point.id, friendId: 'friend-a' }),
      ]);
      expect(first.id).toBe(second.id);
      expect(countEvents(connA, point.id)).toBe(1);
    } finally {
      connA.close();
      connB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('rolling window境界の固定時刻を2接続でまたいでも期間内二重計上しない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-367-boundary-'));
    const path = join(dir, 'shared.db');
    const setup = new Database(path);
    setup.pragma('journal_mode = WAL');
    applyConversionTestSchema(setup);
    setup.close();
    const connA = new Database(path, { timeout: 3000 });
    const connB = new Database(path, { timeout: 3000 });
    try {
      insertFriend(connA, 'friend-a');
      const d1a = asD1(connA);
      const d1b = asD1(connB);
      const point = await createConversionPoint(d1a, { name: '月次利用', eventType: 'monthly' });
      connA.prepare(`UPDATE conversion_points SET deduplication_mode = 'window',
        deduplication_window_days = 30 WHERE id = ?`).run(point.id);
      const firstAt = Date.parse('2026-01-01T00:00:00.000Z');
      const boundaryAt = firstAt + 30 * 86_400_000;
      const first = await trackConversion(
        d1a,
        { conversionPointId: point.id, friendId: 'friend-a' },
        { now: firstAt },
      );

      const atBoundary = await Promise.all([
        trackConversion(d1a, { conversionPointId: point.id, friendId: 'friend-a' }, { now: boundaryAt }),
        trackConversion(d1b, { conversionPointId: point.id, friendId: 'friend-a' }, { now: boundaryAt }),
      ]);
      expect(atBoundary.map((event) => event.id)).toEqual([first.id, first.id]);
      expect(countEvents(connA, point.id)).toBe(1);

      const afterBoundary = await Promise.all([
        trackConversion(d1a, { conversionPointId: point.id, friendId: 'friend-a' }, { now: boundaryAt + 1 }),
        trackConversion(d1b, { conversionPointId: point.id, friendId: 'friend-a' }, { now: boundaryAt + 1 }),
      ]);
      expect(afterBoundary[0].id).toBe(afterBoundary[1].id);
      expect(afterBoundary[0].id).not.toBe(first.id);
      expect(countEvents(connA, point.id)).toBe(2);
    } finally {
      connA.close();
      connB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('記録先アカウントの一致条件', () => {
  it('同じ組み合わせだけ通し、全アカウント地点だけ交差を許可する', () => {
    expect(canRecordConversion('acc-a', 'acc-a')).toBe(true);
    expect(canRecordConversion('acc-a', 'acc-b')).toBe(false);
    expect(canRecordConversion('acc-a', null)).toBe(false);
    expect(canRecordConversion(null, 'acc-b')).toBe(true);
    expect(canRecordConversion(null, null)).toBe(true);
  });

  it('helperを直接呼んでも地点と友だちのaccount交差を拒否する', async () => {
    const db = setupFull();
    insertLineAccount(db, 'acc-a');
    insertLineAccount(db, 'acc-b');
    insertFriend(db, 'friend-b', 'acc-b');
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, {
      name: '購入完了', eventType: 'purchase', lineAccountId: 'acc-a',
    });

    await expect(trackConversion(d1, {
      conversionPointId: point.id,
      friendId: 'friend-b',
    })).rejects.toThrow('conversion_account_mismatch');
    expect(countEvents(db, point.id)).toBe(0);
  });
});

describe('N-254 版ガードと利用先確認(DB層)', () => {
  it('版が一致すれば更新して版を進める', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    const updated = await updateConversionPoint(d1, point.id, { name: '購入完了V2' }, { expectedVersion: 1 });
    expect(updated).toMatchObject({ name: '購入完了V2', version: 2 });
  });

  it('版がずれれば更新せず409相当で弾く', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    await expect(updateConversionPoint(d1, point.id, { name: '別名' }, { expectedVersion: 99 }))
      .rejects.toThrow('conversion_point_version_conflict');
    const current = db.prepare('SELECT name, version FROM conversion_points WHERE id = ?').get(point.id);
    expect(current).toEqual({ name: '購入完了', version: 1 });
  });

  it('無い地点は null を返す', async () => {
    const db = setupFull();
    await expect(updateConversionPoint(asD1(db), 'nope', { name: 'x' }, { expectedVersion: 1 }))
      .resolves.toBeNull();
  });

  it('停止は版の一致が要り、止めたら版が進む', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    await expect(stopConversionPoint(d1, point.id, 99))
      .rejects.toThrow('conversion_point_version_conflict');
    const stopped = await stopConversionPoint(d1, point.id, 1);
    expect(stopped).toMatchObject({ status: 'stopped', version: 2 });
    await expect(stopConversionPoint(d1, point.id, 2))
      .rejects.toThrow('conversion_point_already_stopped');
    await expect(stopConversionPoint(d1, 'nope', 1))
      .rejects.toThrow('conversion_point_not_found');
  });

  it('複数接続の更新と停止の競合は片方だけが勝つ', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-367-mut-'));
    const path = join(dir, 'shared.db');
    const setup = new Database(path);
    setup.pragma('journal_mode = WAL');
    applyConversionTestSchema(setup);
    setup.close();
    const connA = new Database(path, { timeout: 3000 });
    const connB = new Database(path, { timeout: 3000 });
    try {
      const d1a = asD1(connA);
      const point = await createConversionPoint(d1a, { name: '購入完了', eventType: 'purchase' });
      const d1b = asD1(connB);
      const settled = await Promise.allSettled([
        updateConversionPoint(d1a, point.id, { name: '別名A' }, { expectedVersion: 1 }),
        stopConversionPoint(d1b, point.id, 1),
      ]);
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason))
        .toContain('conversion_point_version_conflict');
      const current = connA.prepare('SELECT version FROM conversion_points WHERE id = ?').get(point.id) as { version: number };
      expect(current.version).toBe(2);
    } finally {
      connA.close();
      connB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('成果・利用先の有無を返す', async () => {
    const db = setupFull();
    const d1 = asD1(db);
    const point = await createConversionPoint(d1, { name: '購入完了', eventType: 'purchase' });
    insertFriend(db, 'friend-a');
    expect(await hasConversionPointActivity(d1, point.id)).toBe(false);
    await trackConversion(d1, { conversionPointId: point.id, friendId: 'friend-a' });
    expect(await hasConversionPointActivity(d1, point.id)).toBe(true);

    const unused = await createConversionPoint(d1, { name: '未使用', eventType: 'signup' });
    expect(await hasConversionPointActivity(d1, unused.id)).toBe(false);
    insertLineAccount(db, 'account-1');
    db.prepare(
      `INSERT INTO conversion_definition_usages
         (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
       VALUES ('usage-1', ?, 1, 'account-1', 'scenario', 'scenario-1', 'staff-1', '2026-09-01', '2026-09-01')`,
    ).run(unused.id);
    expect(await hasConversionPointActivity(d1, unused.id)).toBe(true);
  });
});
