import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '333_webinar_folder_contract.sql'),
  'utf8',
)

describe('migration 333 webinar folder contract', () => {
  it('既存の共有フォルダをアカウント別へ分けてウェビナーを付け替える', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE webinars (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES line_accounts(id),
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO folders (id, kind, name, created_at, updated_at)
      VALUES ('folder-shared', 'webinar', '商品説明', '2026-09-07', '2026-09-07');
      INSERT INTO webinars (id, account_id, folder_id)
      VALUES ('webinar-a', 'account-a', 'folder-shared'),
             ('webinar-b', 'account-b', 'folder-shared');
    `)

    sqlite.exec(migration)

    expect(sqlite.prepare(`
      SELECT w.id, w.account_id, w.folder_id, f.account_id AS folder_account_id
        FROM webinars w
        JOIN folders f ON f.id = w.folder_id
       ORDER BY w.id
    `).all()).toEqual([
      { id: 'webinar-a', account_id: 'account-a', folder_id: 'folder-shared', folder_account_id: 'account-a' },
      { id: 'webinar-b', account_id: 'account-b', folder_id: 'folder-shared:account:account-b', folder_account_id: 'account-b' },
    ])
    sqlite.close()
  })
})
