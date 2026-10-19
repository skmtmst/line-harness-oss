import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '194_saved_search_account_scope.sql'),
  'utf8',
);

describe('migration 194 saved search account scope', () => {
  it('preserves existing searches as unassigned and adds the account index', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE saved_searches (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL,
        conditions_json TEXT NOT NULL, created_by TEXT, is_shared INTEGER NOT NULL,
        display_order INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO saved_searches VALUES
        ('search-1', '既存', 'friends', '{}', 'staff-1', 0, 0, 'before');
    `);

    db.exec(migration);

    const row = db.prepare('SELECT * FROM saved_searches').get() as Record<string, unknown>;
    expect(row).toMatchObject({ id: 'search-1', name: '既存', line_account_id: null });
    const indexes = db.prepare("PRAGMA index_list('saved_searches')").all() as Array<{ name: string }>;
    expect(indexes.map((item) => item.name)).toContain('idx_saved_searches_account_scope');
  });
});
