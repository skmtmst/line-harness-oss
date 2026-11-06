import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '396_line_account_profile.sql'), 'utf8')

describe('396 LINE公式プロフィール保存列', () => {
  it('既存のアカウント行を変えずに4列を追加する', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO line_accounts VALUES (\'a\', \'運用名\');')
    db.exec(migration)
    const columns = db.prepare('PRAGMA table_info(line_accounts)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'line_display_name', 'line_picture_url', 'line_basic_id', 'line_profile_synced_at',
    ]))
    expect(db.prepare('SELECT * FROM line_accounts WHERE id = ?').get('a')).toMatchObject({
      id: 'a', name: '運用名', line_display_name: null, line_picture_url: null,
      line_basic_id: null, line_profile_synced_at: null,
    })
    db.close()
  })
})
