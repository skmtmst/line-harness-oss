import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'

describe('291 rich menu schedules', () => {
  let sqlite: Database.Database

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
      INSERT INTO line_accounts VALUES ('account-1');
      INSERT INTO line_accounts VALUES ('account-2');
      INSERT INTO rich_menu_groups VALUES ('menu-1', 'account-1');
      INSERT INTO rich_menu_groups VALUES ('menu-2', 'account-2');
    `)
    sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/291_rich_menu_schedules.sql'), 'utf8'))
  })

  test('予約時点の定義と終了後の戻し先を保持する', () => {
    sqlite.prepare(`INSERT INTO rich_menu_schedules
      (id, group_id, account_id, mode, starts_at, ends_at, restore_group_id,
       definition_snapshot, idempotency_key, requested_by_staff_id, created_at, updated_at)
      VALUES ('schedule-1', 'menu-1', 'account-1', 'period', '2026-09-10T01:00:00.000Z',
              '2026-09-30T14:59:00.000Z', 'menu-1', '{"name":"公開時の内容"}',
              'request-1', 'staff-1', '2026-09-06', '2026-09-06')`).run()

    expect(sqlite.prepare(`SELECT mode, restore_group_id, definition_snapshot, status
      FROM rich_menu_schedules WHERE id = 'schedule-1'`).get()).toEqual({
      mode: 'period',
      restore_group_id: 'menu-1',
      definition_snapshot: '{"name":"公開時の内容"}',
      status: 'scheduled',
    })
  })

  test('同じ実行キーの二重予約をDBで拒否する', () => {
    const insert = sqlite.prepare(`INSERT INTO rich_menu_schedules
      (id, group_id, account_id, mode, starts_at, definition_snapshot,
       idempotency_key, requested_by_staff_id, created_at, updated_at)
      VALUES (?, 'menu-1', 'account-1', 'scheduled', '2026-09-10T01:00:00.000Z', '{}',
              'same-key', 'staff-1', '2026-09-06', '2026-09-06')`)
    insert.run('schedule-1')
    expect(() => insert.run('schedule-2')).toThrow(/UNIQUE/)
  })

  test('別のLINEアカウントは同じ実行キーを安全に使える', () => {
    const insert = sqlite.prepare(`INSERT INTO rich_menu_schedules
      (id, group_id, account_id, mode, starts_at, definition_snapshot,
       idempotency_key, requested_by_staff_id, created_at, updated_at)
      VALUES (?, ?, ?, 'scheduled', '2026-09-10T01:00:00.000Z', '{}',
              'same-key', 'staff-1', '2026-09-06', '2026-09-06')`)

    insert.run('schedule-1', 'menu-1', 'account-1')
    insert.run('schedule-2', 'menu-2', 'account-2')

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM rich_menu_schedules').get()).toEqual({ count: 2 })
  })

  test('期間予約は終了日時を必須にする', () => {
    expect(() => sqlite.prepare(`INSERT INTO rich_menu_schedules
      (id, group_id, account_id, mode, starts_at, definition_snapshot,
       idempotency_key, requested_by_staff_id, created_at, updated_at)
      VALUES ('schedule-1', 'menu-1', 'account-1', 'period', '2026-09-10', '{}',
              'key', 'staff-1', '2026-09-06', '2026-09-06')`).run()).toThrow(/CHECK/)
  })
})
