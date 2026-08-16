import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 094（イベントの公開設定）と 098（キャンセル待ち）が、既存の行の
 * 見え方を変えないことと、二重に並べないことを確かめる。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  // bootstrap.sql は schema.sql + 全マイグレーション適用済みの現行スキーマ。
  // 手書きの ALTER を並べると、列が増えるたびに追随が要る。
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

let db: Database.Database;

beforeEach(() => {
  db = setupDb();
  db.prepare(
    `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, created_at, updated_at)
     VALUES ('acc-1', 'A店', 'c1', 's1', 't1', '2026-01-01', '2026-01-01')`,
  ).run();
});

describe('094 の既定値', () => {
  test('列を指定せずに作った行は、これまでと同じ扱いになる', () => {
    db.prepare(
      `INSERT INTO events (id, line_account_id, name) VALUES ('e-1', 'acc-1', '体験会')`,
    ).run();
    const row = db.prepare(`SELECT * FROM events WHERE id = 'e-1'`).get() as Record<string, unknown>;
    expect(row.visible_tag_id).toBeNull(); // 友だち全員に見える
    expect(row.waitlist_enabled).toBe(0); // 満席なら締め切る
    expect(row.entry_cutoff_hours_before).toBeNull(); // 開始まで受ける
  });
});

describe('098 キャンセル待ち', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO events (id, line_account_id, name, waitlist_enabled)
       VALUES ('e-1', 'acc-1', '体験会', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
       VALUES ('s-1', 'e-1', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z', 1)`,
    ).run();
  });

  const insert = (id: string, identityKey: string, slot = 's-1') =>
    db
      .prepare(
        `INSERT OR IGNORE INTO event_waitlist
           (id, event_id, slot_id, friend_id, identity_key, status, created_at)
         VALUES (?, 'e-1', ?, 'f-1', ?, 'waiting', '2026-08-16T00:00:00.000Z')`,
      )
      .run(id, slot, identityKey);

  test('同じ枠に同じ人は二度並べない', () => {
    insert('w-1', 'uid:abc');
    const result = insert('w-2', 'uid:abc');
    expect(result.changes).toBe(0);
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM event_waitlist`).get() as { c: number };
    expect(c).toBe(1);
  });

  test('別の人なら並べる', () => {
    insert('w-1', 'uid:abc');
    insert('w-2', 'uid:def');
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM event_waitlist`).get() as { c: number };
    expect(c).toBe(2);
  });

  test('枠が違えば同じ人でも並べる', () => {
    db.prepare(
      `INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
       VALUES ('s-2', 'e-1', '2026-09-02T01:00:00.000Z', '2026-09-02T02:00:00.000Z', 1)`,
    ).run();
    insert('w-1', 'uid:abc', 's-1');
    insert('w-2', 'uid:abc', 's-2');
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM event_waitlist`).get() as { c: number };
    expect(c).toBe(2);
  });

  test('待ちの人は予約の件数に入らない', () => {
    // 別テーブルにした理由そのもの。event_bookings を数えている箇所へ
    // 「待ちは数えない」条件を足して回らずに済む。
    insert('w-1', 'uid:abc');
    const { c } = db
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE slot_id = 's-1' AND status IN ('requested','confirmed')`,
      )
      .get() as { c: number };
    expect(c).toBe(0);
  });

  test('知らない状態は入らない', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO event_waitlist (id, event_id, slot_id, friend_id, identity_key, status, created_at)
           VALUES ('w-9', 'e-1', 's-1', 'f-1', 'uid:xyz', 'attended', '2026-08-16T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
  });
});
