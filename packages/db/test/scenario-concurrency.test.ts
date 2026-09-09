import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScenario, enrollFriendInScenario, updateScenario } from '../src/scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          const info = sqlite.prepare(query).run();
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

function insertFriend(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'テスト', '2026-08-16', '2026-08-16')`,
    )
    .run(id, `U${id.padEnd(32, '0').slice(0, 32)}`);
}

async function withStep(name: string, allowConcurrent?: boolean) {
  const scenario = await createScenario(db, {
    name,
    triggerType: 'manual',
    allowConcurrent,
  });
  // ステップが無いシナリオは即 completed になるので、1つ入れておく。
  sqlite
    .prepare(
      `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
       VALUES (?, ?, 0, 60, 'text', 'こんにちは')`,
    )
    .run(crypto.randomUUID(), scenario.id);
  return scenario;
}

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
  insertFriend('f-1');
});

describe('シナリオの並行購読', () => {
  test('既定では並行を許す（従来どおり）', async () => {
    // ここを既定で塞ぐと、いま複数のシナリオに入っている人への配信が止まる。
    const a = await withStep('A');
    const b = await withStep('B');
    expect(a.allow_concurrent).toBe(1);
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).not.toBeNull();
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('並行を止めたシナリオは、他が動いていたら登録しない', async () => {
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    // 例外ではなく null。呼び出し口が友だち追加などの副作用の中にあり、
    // throw すると本来の処理まで巻き添えで失敗する。
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).toBeNull();
  });

  test('他が動いていなければ登録できる', async () => {
    const b = await withStep('B', false);
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('前のシナリオが終わっていれば登録できる', async () => {
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    sqlite.prepare(`UPDATE friend_scenarios SET status = 'completed'`).run();
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('同じシナリオへの二重登録は、並行を許していても起きない', async () => {
    // これは部分UNIQUE索引が防いでいる。allow_concurrent とは別の話。
    const a = await withStep('A');
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).not.toBeNull();
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).toBeNull();
  });

  test('あとから並行を止められる', async () => {
    const a = await withStep('A');
    const b = await withStep('B');
    await enrollFriendInScenario(db, 'f-1', a.id);
    await updateScenario(db, b.id, { allow_concurrent: 0 });
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).toBeNull();
  });

  test('別の友だちには影響しない', async () => {
    insertFriend('f-2');
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    expect(await enrollFriendInScenario(db, 'f-2', b.id)).not.toBeNull();
  });
});
