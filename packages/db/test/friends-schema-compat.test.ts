import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import { upsertFriend } from '../src/friends.js';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function legacyDb(): { d1: D1Database; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      line_user_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      picture_url TEXT,
      status_message TEXT,
      is_following INTEGER NOT NULL DEFAULT 1,
      user_id TEXT,
      line_account_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      first_tracked_link_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const d1 = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...values) }; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) as T) ?? null; },
      };
    },
  } as unknown as D1Database;
  return { d1, sqlite };
}

describe('upsertFriend schema compatibility', () => {
  test('creates and updates friends before migration 065 is applied', async () => {
    const { d1, sqlite } = legacyDb();

    const created = await upsertFriend(d1, {
      lineUserId: 'U-legacy',
      lineAccountId: 'account-legacy',
      displayName: 'Before',
      pictureUrl: null,
      statusMessage: null,
    });
    expect(created.display_name).toBe('Before');
    expect(created.line_account_id).toBe('account-legacy');

    const updated = await upsertFriend(d1, {
      lineUserId: 'U-legacy',
      lineAccountId: 'account-legacy',
      displayName: 'After',
      pictureUrl: null,
      statusMessage: null,
    });
    expect(updated.display_name).toBe('After');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM friends').get()).toEqual({ count: 1 });
  });
});
