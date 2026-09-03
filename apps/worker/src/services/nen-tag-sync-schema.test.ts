import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn().mockResolvedValue({ added: true }),
  detachTagAndFireSideEffects: vi.fn().mockResolvedValue({ removed: true }),
}));

const { refreshAllNenTags } = await import('./nen-tag-sync.js');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = sqlite.prepare(query).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } } as T;
      },
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('NENタグ定期再判定の実DBカーソル', () => {
  it('20人ずつ進み、健康記録の一括SQLと次回カーソルが実スキーマで動く', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'),
      'utf8',
    ));
    const insertFriend = sqlite.prepare(
      `INSERT INTO friends
         (id, line_user_id, user_id, is_following, created_at, updated_at)
       VALUES (?, ?, ?, 1, '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
    );
    for (let index = 0; index < 21; index += 1) {
      const value = String(index).padStart(2, '0');
      insertFriend.run(`friend-${value}`, `U${value}`, `ec-${value}`);
    }
    sqlite.prepare(
      `INSERT INTO nen_pet_profiles
         (id, friend_id, name, animal_type, gender, created_at, updated_at)
       VALUES ('pet-00', 'friend-00', 'ポチ', 'dog', 'unknown',
               '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO nen_health_logs
         (id, pet_id, friend_id, logged_on, stool_status, appetite, created_at)
       VALUES ('health-00', 'pet-00', 'friend-00', '2026-09-03', 'normal', 'normal',
               '2026-09-03T00:00:00.000')`,
    ).run();
    const db = asD1(sqlite);

    const first = await refreshAllNenTags(
      db,
      { allTenants: true },
      500,
      new Date('2026-09-04T00:00:00.000Z'),
    );
    const second = await refreshAllNenTags(
      db,
      { allTenants: true },
      500,
      new Date('2026-09-04T06:00:00.000Z'),
    );

    expect(first).toMatchObject({ friends: 20, hasMore: true, cursor: 'friend-19' });
    expect(second).toMatchObject({ friends: 1, hasMore: false, cursor: null });
    expect(sqlite.prepare(
      `SELECT last_friend_id, cycle_started_at FROM nen_tag_refresh_state WHERE id = 1`,
    ).get()).toEqual({
      last_friend_id: '',
      cycle_started_at: '2026-09-04T06:00:00.000Z',
    });
    sqlite.close();
  });
});
