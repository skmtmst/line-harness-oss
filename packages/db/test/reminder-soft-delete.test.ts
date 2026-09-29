import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteReminder, getPendingReminderDeliveries, getReminderById, getReminders } from '../src/reminders.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query)
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} }
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null
      },
      async run<T>() {
        const info = statement.run(...params)
        return { success: true, meta: { changes: info.changes }, results: [] } as T
      },
      raw: async () => [],
    }) as unknown as D1PreparedStatement
    return make([])
  }

  return {
    prepare,
    batch: async <T = unknown>(statements: D1PreparedStatement[]) =>
      Promise.all(statements.map((statement) => statement.run<T>())),
  } as unknown as D1Database
}

describe('リマインダの安全削除', () => {
  let sqlite: Database.Database
  let db: D1Database

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'))
    db = asD1(sqlite)

    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-1', 'U1', 'account-1');
      INSERT INTO reminders
        (id, name, line_account_id, is_active, trigger_type, delivery_mode)
      VALUES ('reminder-1', '未返信3日後フォロー', 'account-1', 1, 'manual', 'countdown');
      INSERT INTO reminder_steps
        (id, reminder_id, offset_minutes, message_type, message_content)
      VALUES ('step-1', 'reminder-1', 60, 'text', 'ご案内です');
      INSERT INTO friend_reminders
        (id, friend_id, reminder_id, target_date, status)
      VALUES ('enrollment-active', 'friend-1', 'reminder-1', '2026-09-01T10:00:00', 'active'),
             ('enrollment-done', 'friend-1', 'reminder-1', '2026-08-01T10:00:00', 'completed');
      INSERT INTO friend_reminder_deliveries
        (id, friend_reminder_id, reminder_step_id)
      VALUES ('delivery-1', 'enrollment-done', 'step-1');
    `)
  })

  afterEach(() => sqlite.close())

  it('一覧と配信対象から外し、未送信だけ取消し、送信済み履歴を残す', async () => {
    await deleteReminder(db, 'reminder-1')

    expect(await getReminderById(db, 'reminder-1')).toBeNull()
    expect(await getReminders(db)).toEqual([])
    expect(await getPendingReminderDeliveries(db)).toEqual([])

    const reminder = sqlite.prepare(
      `SELECT is_active, deleted_at FROM reminders WHERE id = 'reminder-1'`,
    ).get() as { is_active: number; deleted_at: string | null }
    expect(reminder.is_active).toBe(0)
    expect(reminder.deleted_at).not.toBeNull()

    const enrollments = sqlite.prepare(
      `SELECT id, status FROM friend_reminders WHERE reminder_id = 'reminder-1' ORDER BY id`,
    ).all() as Array<{ id: string; status: string }>
    expect(enrollments).toEqual([
      { id: 'enrollment-active', status: 'cancelled' },
      { id: 'enrollment-done', status: 'completed' },
    ])
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM reminder_steps`).get()).toEqual({ count: 1 })
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_reminder_deliveries`).get()).toEqual({ count: 1 })
  })

  it('同じ削除をやり直しても履歴と取消状態を壊さない', async () => {
    await deleteReminder(db, 'reminder-1')
    const firstDeletedAt = (sqlite.prepare(
      `SELECT deleted_at FROM reminders WHERE id = 'reminder-1'`,
    ).get() as { deleted_at: string }).deleted_at

    await deleteReminder(db, 'reminder-1')

    expect((sqlite.prepare(
      `SELECT deleted_at FROM reminders WHERE id = 'reminder-1'`,
    ).get() as { deleted_at: string }).deleted_at).toBe(firstDeletedAt)
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_reminder_deliveries`).get()).toEqual({ count: 1 })
  })
})
