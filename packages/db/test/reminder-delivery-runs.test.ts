import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  claimReminderDeliveryRun,
  completeReminderDeliveryRunStatement,
  completeReminderIfDone,
  deleteReminder,
  failReminderDeliveryRun,
  getReminderDeliveryRunById,
  getReminderDeliveryRunSummary,
  listReminderDeliveryRuns,
  retryReminderDeliveryRun,
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

describe('リマインダ実行記録', () => {
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
      INSERT INTO reminders
        (id, name, line_account_id, is_active, trigger_type, delivery_mode)
      VALUES ('reminder-1', '来店前のお知らせ', 'account-1', 1, 'manual', 'countdown');
      INSERT INTO reminder_steps
        (id, reminder_id, offset_minutes, message_type, message_content)
      VALUES ('step-1', 'reminder-1', -60, 'text', 'ご来店をお待ちしています');
      INSERT INTO friend_reminders
        (id, friend_id, reminder_id, target_date, status)
      VALUES ('enrollment-1', 'friend-1', 'reminder-1', '2026-08-28T10:00:00.000Z', 'active');
    `)
  })

  afterEach(() => sqlite.close())

  async function claim(now: string, lease = '2026-08-28T09:05:00.000Z') {
    return claimReminderDeliveryRun(db, {
      lineAccountId: 'account-1',
      reminderId: 'reminder-1',
      friendReminderId: 'enrollment-1',
      friendId: 'friend-1',
      reminderStepId: 'step-1',
      scheduledAt: '2026-08-28T09:00:00.000Z',
      now,
      leaseExpiresAt: lease,
    })
  }

  it('同じ配信を同時に二重取得せず、期限切れ後も同じLINE再送キーで引き継ぐ', async () => {
    const first = await claim('2026-08-28T09:00:00.000Z')
    expect(first?.status).toBe('claimed')
    expect(first?.attempt_count).toBe(1)

    expect(await claim('2026-08-28T09:01:00.000Z')).toBeNull()

    const recovered = await claim(
      '2026-08-28T09:06:00.000Z',
      '2026-08-28T09:11:00.000Z',
    )
    expect(recovered?.id).toBe(first?.id)
    expect(recovered?.line_retry_key).toBe(first?.line_retry_key)
    expect(recovered?.attempt_count).toBe(2)
  })

  it('次の予定は計画時刻を出し、再試行待ちでは過去の予定より再試行時刻を出す', async () => {
    sqlite.prepare(
      `INSERT INTO reminder_delivery_runs (
         id, line_account_id, reminder_id, friend_reminder_id, friend_id,
         reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
         status, next_retry_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'run-future', 'account-1', 'reminder-1', 'enrollment-1', 'friend-1',
      'step-1', '2026-08-29T09:00:00.000Z', 'future-key', 'future-retry-key',
      'queued', null, '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z',
    )

    expect((await getReminderDeliveryRunSummary(db, 'reminder-1')).nextScheduledAt)
      .toBe('2026-08-29T09:00:00.000Z')

    sqlite.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'retry_wait', scheduled_at = ?, next_retry_at = ?
        WHERE id = 'run-future'`,
    ).run('2026-08-28T08:00:00.000Z', '2026-08-28T10:00:00.000Z')

    expect((await getReminderDeliveryRunSummary(db, 'reminder-1')).nextScheduledAt)
      .toBe('2026-08-28T10:00:00.000Z')
  })

  it('再試行時刻までは取らず、手動再試行は同じ受付キーを二重登録しない', async () => {
    const run = await claim('2026-08-28T09:00:00.000Z')
    await failReminderDeliveryRun(db, {
      id: run!.id,
      code: 'line_temporary_failure',
      message: 'LINEへの送信に一時的に失敗しました。自動で再試行します。',
      retryAt: '2026-08-28T09:05:00.000Z',
      now: '2026-08-28T09:00:01.000Z',
    })

    expect(await claim('2026-08-28T09:04:59.000Z')).toBeNull()
    const automaticRetry = await claim(
      '2026-08-28T09:05:00.000Z',
      '2026-08-28T09:10:00.000Z',
    )
    expect(automaticRetry?.attempt_count).toBe(2)

    await failReminderDeliveryRun(db, {
      id: run!.id,
      code: 'line_rejected',
      message: '送信内容または宛先を確認してください。',
      retryAt: null,
      now: '2026-08-28T09:05:01.000Z',
    })
    sqlite.prepare(
      `UPDATE friend_reminders SET status = 'completed' WHERE id = 'enrollment-1'`,
    ).run()
    const oldRetryKey = (await getReminderDeliveryRunById(db, run!.id))!.line_retry_key
    const requestKey = '11111111-1111-4111-8111-111111111111'
    const scheduled = await retryReminderDeliveryRun(db, {
      id: run!.id,
      requestKey,
      now: '2026-08-28T09:06:00.000Z',
    })
    expect(scheduled?.kind).toBe('scheduled')
    expect(scheduled?.run.line_retry_key).not.toBe(oldRetryKey)
    expect(sqlite.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'active' })

    const replay = await retryReminderDeliveryRun(db, {
      id: run!.id,
      requestKey,
      now: '2026-08-28T09:06:01.000Z',
    })
    expect(replay?.kind).toBe('replay')
  })

  it('取り消した登録を失敗履歴から再開しない', async () => {
    const run = await claim('2026-08-28T09:00:00.000Z')
    await failReminderDeliveryRun(db, {
      id: run!.id,
      code: 'line_rejected',
      message: '送信内容または宛先を確認してください。',
      retryAt: null,
      now: '2026-08-28T09:00:01.000Z',
    })
    sqlite.prepare(
      `UPDATE friend_reminders SET status = 'cancelled' WHERE id = 'enrollment-1'`,
    ).run()

    const result = await retryReminderDeliveryRun(db, {
      id: run!.id,
      requestKey: '22222222-2222-4222-8222-222222222222',
      now: '2026-08-28T09:01:00.000Z',
    })

    expect(result?.kind).toBe('conflict')
    expect((await getReminderDeliveryRunById(db, run!.id))?.status).toBe('permanent_failed')
  })

  it('成功と失敗を一覧・集計に出し、終端になった登録を完了へ進める', async () => {
    const run = await claim('2026-08-28T09:00:00.000Z')
    await db.batch([
      db.prepare(
        `INSERT INTO friend_reminder_deliveries
           (id, friend_reminder_id, reminder_step_id, delivered_at)
         VALUES ('delivery-1', 'enrollment-1', 'step-1', ?)`,
      ).bind('2026-08-28T09:00:02.000Z'),
      completeReminderDeliveryRunStatement(db, {
        id: run!.id,
        lineRequestId: 'line-request-1',
        messageLogId: 'message-log-1',
        now: '2026-08-28T09:00:02.000Z',
      }),
    ])
    await completeReminderIfDone(db, 'enrollment-1', 'reminder-1')

    const summary = await getReminderDeliveryRunSummary(db, 'reminder-1')
    expect(summary).toEqual({
      sent: 1,
      scheduled: 0,
      stopped: 0,
      errors: 0,
      targetCount: 1,
      nextScheduledAt: null,
    })
    const list = await listReminderDeliveryRuns(db, {
      reminderId: 'reminder-1',
      search: '田中',
      limit: 20,
      offset: 0,
    })
    expect(list.total).toBe(1)
    expect(list.items[0]).toMatchObject({
      friend_name: '田中さくら',
      status: 'succeeded',
      line_request_id: 'line-request-1',
      message_log_id: 'message-log-1',
      step_number: 1,
    })
    expect(sqlite.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'completed' })
  })

  it('削除時は待機中の実行だけ取消し、成功履歴を残す', async () => {
    const run = await claim('2026-08-28T09:00:00.000Z')
    await failReminderDeliveryRun(db, {
      id: run!.id,
      code: 'line_temporary_failure',
      message: '再試行待ちです。',
      retryAt: '2026-08-28T09:05:00.000Z',
      now: '2026-08-28T09:00:01.000Z',
    })

    await deleteReminder(db, 'reminder-1')

    expect((await getReminderDeliveryRunById(db, run!.id))?.status).toBe('cancelled')
    expect(sqlite.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'cancelled' })
  })
})
