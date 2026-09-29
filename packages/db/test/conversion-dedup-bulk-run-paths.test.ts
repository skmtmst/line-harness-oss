import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { trackConversion } from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

/*
 * 成果の重複排除は claim 表で直列化しているが、claim を通らずに
 * `conversion_events` を直接書き換える経路が製品にある。
 *
 *   apps/worker/src/services/friend-bulk-runs.ts
 *     add_conversion    → conversion_events へ直接 INSERT
 *     remove_conversion → conversion_events を直接 DELETE（undo も同じ）
 *
 * claim だけを権威にすると、前者で「1人1回」が破れ、後者では claim が
 * 孤児として残って再計上が詰まる。数え方の権威は成果表そのものに置く。
 *
 * 生成物の `bootstrap.sql` をそのまま流し、実際に出荷される DDL
 * （`last_event_id` に外部キーが無いこと）の上で確かめる。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP = readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8');

const POINT = 'point-lifetime';
const FRIEND = 'friend-a';

function setup(): DatabaseType.Database {
  const db = new Database(':memory:');
  db.exec(BOOTSTRAP);
  db.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
     VALUES (?, 'U00000000000000000000000000000001', 'Test User', NULL,
             '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`,
  ).run(FRIEND);
  db.prepare(
    `INSERT INTO conversion_points
       (id, name, event_type, measure_method, count_repeat, deduplication_mode,
        line_account_id, status, version, created_at, updated_at)
     VALUES (?, '1人1回地点', 'signup', 'manual', 0, 'once_per_friend', NULL, 'active', 1,
             '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`,
  ).run(POINT);
  return db;
}

/** friend-bulk-runs の add_conversion と同じ直接INSERT。 */
function bulkAddConversion(db: DatabaseType.Database, eventId: string): void {
  db.prepare(
    `INSERT INTO conversion_events
       (id, conversion_point_id, friend_id, metadata, created_at, approval_status)
     VALUES (?, ?, ?, ?, '2026-01-01T09:00:00.000+09:00', 'approved')`,
  ).run(eventId, POINT, FRIEND, JSON.stringify({ source: 'friend_bulk_run' }));
}

/** friend-bulk-runs の remove_conversion と同じ直接DELETE。 */
function bulkRemoveConversion(db: DatabaseType.Database): number {
  return db.prepare('DELETE FROM conversion_events WHERE friend_id = ? AND conversion_point_id = ?')
    .run(FRIEND, POINT).changes;
}

function eventIds(db: DatabaseType.Database): string[] {
  return (db.prepare(
    'SELECT id FROM conversion_events WHERE conversion_point_id = ? ORDER BY created_at, id',
  ).all(POINT) as Array<{ id: string }>).map((row) => row.id);
}

function claimRows(db: DatabaseType.Database): Array<{ last_event_id: string }> {
  return db.prepare(
    'SELECT last_event_id FROM conversion_event_dedup_claims WHERE conversion_point_id = ?',
  ).all(POINT) as Array<{ last_event_id: string }>;
}

describe('claimを通らない一括操作の経路でも1人1回を守る', () => {
  it('出荷DDLの last_event_id には外部キーが無い（孤児claimが起こりうる前提）', () => {
    const db = setup();
    const ddl = (db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversion_event_dedup_claims'`,
    ).get() as { sql: string }).sql;
    expect(ddl).toContain('last_event_id');
    expect(ddl).not.toMatch(/last_event_id[^,]*REFERENCES/i);
    db.close();
  });

  it('R1: 一括操作が直接INSERTした成果があっても二重計上しない', async () => {
    const db = setup();
    bulkAddConversion(db, 'bulk-event-1');
    expect(eventIds(db)).toEqual(['bulk-event-1']);

    const tracked = await trackConversion(asD1(db), {
      conversionPointId: POINT, friendId: FRIEND,
    });

    // 新しく数えず、一括操作が入れた既存の1件をそのまま返す。
    expect(tracked.id).toBe('bulk-event-1');
    expect(eventIds(db)).toEqual(['bulk-event-1']);
    // 実体の無いclaimを残さない。
    for (const claim of claimRows(db)) {
      expect(eventIds(db)).toContain(claim.last_event_id);
    }
    db.close();
  });

  it('R1: 通常計上のあとに一括操作が足しても、さらに増やさない', async () => {
    const db = setup();
    const first = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    bulkAddConversion(db, 'bulk-event-2');
    expect(eventIds(db)).toHaveLength(2);

    const again = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });

    expect(eventIds(db)).toHaveLength(2);
    expect([first.id, 'bulk-event-2']).toContain(again.id);
    db.close();
  });

  it('R1: 孤児claimが残ったうえに一括操作が足した成果があっても増やさない', async () => {
    const db = setup();
    // 計上 → 一括削除で孤児claim → 一括操作が別の成果を直接INSERT、の順。
    // claimは実体を失っているので奪い直せてしまう。ここで成果表を見ていないと
    // 「1人1回」の地点に2件目が入る。
    const first = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    expect(bulkRemoveConversion(db)).toBe(1);
    bulkAddConversion(db, 'bulk-event-4');
    expect(claimRows(db)).toEqual([{ last_event_id: first.id }]);
    expect(eventIds(db)).toEqual(['bulk-event-4']);

    const again = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });

    expect(again.id).toBe('bulk-event-4');
    expect(eventIds(db)).toEqual(['bulk-event-4']);
    db.close();
  });

  it('R2: 一括削除で孤児claimが残っても、再計上が500にならず1件だけ入る', async () => {
    const db = setup();
    const first = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    expect(claimRows(db)).toEqual([{ last_event_id: first.id }]);

    expect(bulkRemoveConversion(db)).toBe(1);
    // 成果は消えたが claim は外部キーが無いため孤児として残る。
    expect(eventIds(db)).toEqual([]);
    expect(claimRows(db)).toEqual([{ last_event_id: first.id }]);

    const again = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });

    expect(again.id).not.toBe(first.id);
    expect(eventIds(db)).toEqual([again.id]);
    // 孤児claimを奪い直し、実体を指す状態へ戻す。
    expect(claimRows(db)).toEqual([{ last_event_id: again.id }]);
    db.close();
  });

  it('R2: 孤児claimを奪い直したあとも、1人1回の抑止が続く', async () => {
    const db = setup();
    const first = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    bulkRemoveConversion(db);
    const second = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    const third = await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });

    expect(second.id).not.toBe(first.id);
    expect(third.id).toBe(second.id);
    expect(eventIds(db)).toEqual([second.id]);
    db.close();
  });

  it('window地点: 期間外の一括INSERTは抑止せず、期間内の一括INSERTは抑止する', async () => {
    const db = setup();
    db.prepare(
      `UPDATE conversion_points SET deduplication_mode = 'window',
         deduplication_window_days = 30 WHERE id = ?`,
    ).run(POINT);
    const now = Date.parse('2026-03-01T00:00:00.000Z');

    // 期間外(60日前)の直接INSERTは新しい計上を止めない。
    db.prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, approval_status)
       VALUES ('bulk-old', ?, ?, '2026-01-01T09:00:00.000+09:00', 'approved')`,
    ).run(POINT, FRIEND);
    const fresh = await trackConversion(
      asD1(db), { conversionPointId: POINT, friendId: FRIEND }, { now },
    );
    expect(fresh.id).not.toBe('bulk-old');
    expect(eventIds(db)).toHaveLength(2);

    // 期間内の直接INSERTは以後の計上を止める。
    const before = eventIds(db).length;
    const blocked = await trackConversion(
      asD1(db), { conversionPointId: POINT, friendId: FRIEND }, { now: now + 1000 },
    );
    expect(eventIds(db)).toHaveLength(before);
    expect(eventIds(db)).toContain(blocked.id);
    db.close();
  });

  it('every地点: 一括操作の直接INSERTがあっても数え続ける', async () => {
    const db = setup();
    db.prepare(`UPDATE conversion_points SET count_repeat = 1, deduplication_mode = 'every' WHERE id = ?`)
      .run(POINT);
    bulkAddConversion(db, 'bulk-event-3');

    await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });
    await trackConversion(asD1(db), { conversionPointId: POINT, friendId: FRIEND });

    // 繰返し地点は抑止の対象外。過剰に潰していないことを固定する。
    expect(eventIds(db)).toHaveLength(3);
    db.close();
  });
});
