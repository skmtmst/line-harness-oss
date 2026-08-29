import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  cancelReminderEnrollmentsForSource,
  createReminderWithDraftVersion,
  enrollFriendInReminder,
  getReminderDraftVersion,
  getReminderPublishedVersion,
  parseReminderVersionSettings,
  publishReminderDraftVersion,
  saveReminderDraftVersion,
  type ReminderDraftSettings,
} from '../src/reminders.js'

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

function settings(content: string): ReminderDraftSettings {
  return {
    name: '予約前のお知らせ',
    description: '前日に送る',
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    triggerFieldId: null,
    repeatYearly: false,
    triggerOffsetMinutes: null,
    sendAtTime: null,
    targetTagId: null,
    folderId: null,
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: true,
      daysAfterTarget: 7,
      friendBlocked: true,
    },
    steps: [{
      stableStepId: 'day-before',
      offsetMinutes: 0,
      messageType: 'text',
      messageContent: content,
      offsetDays: -1,
      sendAtTime: '18:00',
    }],
  }
}

describe('V6 リマインダの公開版', () => {
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
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-1', 'U1', 'account-1', '田中さくら');
    `)
  })

  afterEach(() => sqlite.close())

  it('公開しても既存登録の版を変えず、新規登録だけ新版へ進める', async () => {
    const created = await createReminderWithDraftVersion(db, settings('明日のご予約です'))
    const version1 = await publishReminderDraftVersion(db, created.reminder.id, 'staff-1')
    const first = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-01T10:00:00.000Z',
      sourceKind: 'booking',
      sourceId: 'booking-1',
      sourceEventId: 'booking:booking-1',
    })

    const draft2 = await saveReminderDraftVersion(db, created.reminder.id, settings('明後日のご予約です'))
    expect(draft2.version_number).toBe(2)
    expect((await getReminderPublishedVersion(db, created.reminder.id))?.id).toBe(version1.id)
    expect(parseReminderVersionSettings((await getReminderDraftVersion(db, created.reminder.id))!).steps[0].messageContent)
      .toBe('明後日のご予約です')

    const version2 = await publishReminderDraftVersion(db, created.reminder.id, 'staff-1')
    const second = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-02T10:00:00.000Z',
      sourceKind: 'booking',
      sourceId: 'booking-2',
      sourceEventId: 'booking:booking-2',
    })

    expect(first.reminder_version_id).toBe(version1.id)
    expect(second.reminder_version_id).toBe(version2.id)
    expect(sqlite.prepare(
      `SELECT status FROM reminder_versions WHERE id = ?`,
    ).get(version1.id)).toEqual({ status: 'superseded' })

    expect(() => sqlite.prepare(
      `UPDATE reminder_versions SET settings_snapshot = '{}' WHERE id = ?`,
    ).run(version1.id)).toThrow('published reminder versions are immutable')
    expect(() => sqlite.prepare(
      `UPDATE reminder_version_steps SET message_content = '書き換え' WHERE reminder_version_id = ?`,
    ).run(version2.id)).toThrow('published reminder version steps are immutable')
    expect(() => sqlite.prepare(
      `DELETE FROM reminder_versions WHERE id = ?`,
    ).run(version2.id)).toThrow('published reminder versions cannot be deleted')
    expect(() => sqlite.prepare(
      `UPDATE reminder_versions SET status = 'draft' WHERE id = ?`,
    ).run(version2.id)).toThrow('published reminder version status cannot move backwards')
  })

  it('予約取消では同じ予約から作った登録と待機中の通だけを止める', async () => {
    const created = await createReminderWithDraftVersion(db, settings('明日のご予約です'))
    await publishReminderDraftVersion(db, created.reminder.id, 'staff-1')
    const enrollment = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-01T10:00:00.000Z',
      sourceKind: 'booking',
      sourceId: 'booking-1',
      sourceEventId: 'booking:booking-1',
    })
    sqlite.prepare(`
      INSERT INTO reminder_delivery_runs (
        id, line_account_id, reminder_id, friend_reminder_id, friend_id,
        reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
        status, created_at, updated_at
      ) VALUES (
        'run-1', 'account-1', ?, ?, 'friend-1', 'day-before',
        '2026-08-31T09:00:00.000Z', 'key-1', 'retry-1', 'planned',
        '2026-08-29T09:00:00.000Z', '2026-08-29T09:00:00.000Z'
      )
    `).run(created.reminder.id, enrollment.id)

    await cancelReminderEnrollmentsForSource(db, {
      sourceKind: 'booking',
      sourceId: 'booking-1',
      reason: '予約が取り消されました。',
    })

    expect(sqlite.prepare(
      `SELECT status, cancel_reason FROM friend_reminders WHERE id = ?`,
    ).get(enrollment.id)).toEqual({ status: 'cancelled', cancel_reason: '予約が取り消されました。' })
    expect(sqlite.prepare(
      `SELECT status FROM reminder_delivery_runs WHERE id = 'run-1'`,
    ).get()).toEqual({ status: 'cancelled' })
  })

  it('予約取消で止めない設定の版は登録と予定を残す', async () => {
    const keepSettings = settings('明日のご予約です')
    keepSettings.stopConditions.bookingCancelled = false
    const created = await createReminderWithDraftVersion(db, keepSettings)
    await publishReminderDraftVersion(db, created.reminder.id, 'staff-1')
    const enrollment = await enrollFriendInReminder(db, {
      reminderId: created.reminder.id,
      friendId: 'friend-1',
      targetDate: '2026-09-01T10:00:00.000Z',
      sourceKind: 'booking',
      sourceId: 'booking-keep',
      sourceEventId: 'booking:booking-keep',
    })
    sqlite.prepare(`
      INSERT INTO reminder_delivery_runs (
        id, line_account_id, reminder_id, friend_reminder_id, friend_id,
        reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
        status, created_at, updated_at
      ) VALUES (
        'run-keep', 'account-1', ?, ?, 'friend-1', 'day-before',
        '2026-08-31T09:00:00.000Z', 'key-keep', 'retry-keep', 'planned',
        '2026-08-29T09:00:00.000Z', '2026-08-29T09:00:00.000Z'
      )
    `).run(created.reminder.id, enrollment.id)

    await cancelReminderEnrollmentsForSource(db, {
      sourceKind: 'booking',
      sourceId: 'booking-keep',
      reason: '予約が取り消されました。',
    })

    expect(sqlite.prepare(
      `SELECT status, cancel_reason FROM friend_reminders WHERE id = ?`,
    ).get(enrollment.id)).toEqual({ status: 'active', cancel_reason: null })
    expect(sqlite.prepare(
      `SELECT status FROM reminder_delivery_runs WHERE id = 'run-keep'`,
    ).get()).toEqual({ status: 'planned' })
  })
})
