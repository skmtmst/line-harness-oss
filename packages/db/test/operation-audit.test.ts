import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordOperation, countOperations } from '../src/operation-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
    },
  });
  return {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => wrap(query, params), ...wrap(query, []) };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

function jstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(__dirname, '..', 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
});

describe('操作の記録', () => {
  test('1件記録して数えられる', async () => {
    await recordOperation(db, { targetKind: 'support_mark', action: 'changed', targetId: 'm1' });
    expect(await countOperations(db, 'support_mark', 'changed', jstDate(-6))).toBe(1);
  });

  test('種類と操作が違えば数えない', async () => {
    await recordOperation(db, { targetKind: 'support_mark', action: 'changed' });
    expect(await countOperations(db, 'saved_search', 'changed', jstDate(-6))).toBe(0);
    expect(await countOperations(db, 'support_mark', 'used', jstDate(-6))).toBe(0);
  });

  test('期間より前のものは数えない', async () => {
    // 設計は「過去7日」で切って見せる。古い記録が混ざると数が膨らむ。
    sqlite
      .prepare(
        `INSERT INTO operation_audit (id, target_kind, action, created_at)
         VALUES ('old', 'support_mark', 'changed', ?)`,
      )
      .run(`${jstDate(-30)}T10:00:00.000+09:00`);
    expect(await countOperations(db, 'support_mark', 'changed', jstDate(-6))).toBe(0);
  });

  test('記録に失敗しても投げない', async () => {
    // 呼び出し側の処理（マークの変更そのもの）を巻き添えにしない。
    const broken = { prepare() { throw new Error('boom'); } } as unknown as D1Database;
    await expect(
      recordOperation(broken, { targetKind: 'tag', action: 'created' }),
    ).resolves.toBeUndefined();
  });

  test('表が無くても数えるほうは0を返す', async () => {
    const broken = { prepare() { throw new Error('no such table'); } } as unknown as D1Database;
    expect(await countOperations(broken, 'tag', 'created', jstDate(-6))).toBe(0);
  });

  test('詳細をJSONで残せる', async () => {
    await recordOperation(db, {
      targetKind: 'support_mark',
      action: 'changed',
      friendId: 'f1',
      detail: { from: 'unread', to: 'resolved' },
    });
    const row = sqlite.prepare(`SELECT friend_id, detail_json FROM operation_audit`).get() as {
      friend_id: string;
      detail_json: string;
    };
    expect(row.friend_id).toBe('f1');
    expect(JSON.parse(row.detail_json)).toEqual({ from: 'unread', to: 'resolved' });
  });
});
