import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEntryRoute, updateEntryRoute } from '../src/entry-routes.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(query);
          return {
            async run() { statement.run(...params); return { results: [], success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('entry route genre', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('stores and updates the grouping genre', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'ashop-instagram',
      genre: 'A店',
      name: 'Instagram',
    });
    expect(created.genre).toBe('A店');

    const updated = await updateEntryRoute(db, created.id, { genre: 'A店 関東' });
    expect(updated?.genre).toBe('A店 関東');
  });

  it('keeps legacy routes uncategorized', async () => {
    const created = await createEntryRoute(db, { refCode: 'legacy', name: '既存リンク' });
    expect(created.genre).toBeNull();
  });
});
