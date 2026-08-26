import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { reorderTags } from '../src/tags.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

describe('タグの並び替え', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO tags (id, name, display_order)
      VALUES ('a', 'A', 10), ('b', 'B', 20), ('c', 'C', 30), ('d', 'D', 40);
    `);
    db = asD1(sqlite);
  });

  it('絞り込まれた2件だけを入れ替えても、ほかのタグの位置を変えない', async () => {
    await reorderTags(db, ['d', 'b']);

    const rows = sqlite
      .prepare('SELECT id, display_order FROM tags ORDER BY display_order ASC')
      .all() as Array<{ id: string; display_order: number }>;

    expect(rows).toEqual([
      { id: 'a', display_order: 0 },
      { id: 'd', display_order: 1 },
      { id: 'c', display_order: 2 },
      { id: 'b', display_order: 3 },
    ]);
  });

  it('全件が渡されたときは、その順番をそのまま保存する', async () => {
    await reorderTags(db, ['c', 'a', 'd', 'b']);

    const ids = sqlite
      .prepare('SELECT id FROM tags ORDER BY display_order ASC')
      .all()
      .map((row) => (row as { id: string }).id);

    expect(ids).toEqual(['c', 'a', 'd', 'b']);
  });

  it('空または1件だけなら書き換えない', async () => {
    await reorderTags(db, []);
    await reorderTags(db, ['d']);

    const rows = sqlite
      .prepare('SELECT id, display_order FROM tags ORDER BY display_order ASC')
      .all();
    expect(rows).toEqual([
      { id: 'a', display_order: 10 },
      { id: 'b', display_order: 20 },
      { id: 'c', display_order: 30 },
      { id: 'd', display_order: 40 },
    ]);
  });
});
