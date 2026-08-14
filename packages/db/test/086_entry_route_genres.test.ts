import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEntryRoute,
  createEntryRouteGenre,
  getEntryRoutes,
  getEntryRouteGenres,
  updateEntryRouteGenre,
} from '../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() { statement.run(...params); return { success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
        async all<T>() { return { results: statement.all() as T[], success: true, meta: {} }; },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

describe('entry route genres', () => {
  let db: D1Database;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('keeps an empty genre before any links are created', async () => {
    const genre = await createEntryRouteGenre(db, 'A店');
    expect(genre.name).toBe('A店');
    expect(await getEntryRouteGenres(db)).toEqual([expect.objectContaining({ name: 'A店' })]);
  });

  it('automatically registers genres used by compatible API clients', async () => {
    await createEntryRoute(db, { refCode: 'ashop-instagram', genre: 'A店', name: 'Instagram' });
    expect(await getEntryRouteGenres(db)).toEqual([expect.objectContaining({ name: 'A店' })]);
  });

  it('renames the genre and moves its existing links together', async () => {
    const genre = await createEntryRouteGenre(db, 'A店');
    await createEntryRoute(db, { refCode: 'ashop-instagram', genre: 'A店', name: 'Instagram' });
    await createEntryRoute(db, { refCode: 'ashop-x', genre: 'A店', name: 'X' });

    expect(await updateEntryRouteGenre(db, genre.id, 'A店 SNS')).toEqual(
      expect.objectContaining({ name: 'A店 SNS' }),
    );
    expect(await getEntryRoutes(db)).toEqual([
      expect.objectContaining({ genre: 'A店 SNS' }),
      expect.objectContaining({ genre: 'A店 SNS' }),
    ]);
  });
});
