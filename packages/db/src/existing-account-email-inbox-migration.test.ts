import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('既存アカウントのメール表示だけを残し、適用後の新規アカウントはLINEのみになる', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE line_accounts (id TEXT PRIMARY KEY); CREATE TABLE account_settings (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(line_account_id,key)); INSERT INTO line_accounts VALUES (\'existing\');')
    const migration = readFileSync(new URL('../migrations/737_existing_account_email_inbox.sql', import.meta.url), 'utf8')
    db.exec(migration)
    db.exec(migration)
    db.exec("INSERT INTO line_accounts VALUES ('new')")
    const rows = db.prepare("SELECT line_account_id, value FROM account_settings WHERE key='inbox_email_legacy_enabled' ORDER BY line_account_id").all()
    expect(rows).toEqual([{ line_account_id: 'existing', value: 'true' }])
  } finally {
    db.close()
  }
})
