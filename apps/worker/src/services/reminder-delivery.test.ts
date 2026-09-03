import { describe, expect, it } from 'vitest'

import type { LineClient } from '@line-crm/line-sdk'

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { classifyReminderDeliveryError, processReminderDeliveries } from './reminder-delivery.js'

function seedReminder(
  raw: import('better-sqlite3').Database,
  overrides: { isFollowing?: boolean; offsetMinutes?: number } = {},
): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '本店', 'token', 'secret')`,
  ).run()
  insertFriend(raw, 'friend-1', {
    line_user_id: 'U-friend-1',
    line_account_id: 'account-1',
    display_name: '田中さくら',
    is_following: overrides.isFollowing === false ? 0 : 1,
  })
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode)
     VALUES ('reminder-1', '来店前のお知らせ', 'account-1', 1, 'manual', 'countdown')`,
  ).run()
  raw.prepare(
    `INSERT INTO reminder_steps
       (id, reminder_id, offset_minutes, message_type, message_content)
     VALUES ('step-1', 'reminder-1', ?, 'text', 'ご来店をお待ちしています')`,
  ).run(overrides.offsetMinutes ?? -60)
  raw.prepare(
    `INSERT INTO friend_reminders
       (id, friend_id, reminder_id, target_date, status)
     VALUES ('enrollment-1', 'friend-1', 'reminder-1', '2026-08-28T10:00:00.000Z', 'active')`,
  ).run()
}

function makeClient(
  send: (userId: string, retryKey: string | undefined) => Promise<{ requestId: string | null }>,
): LineClient {
  return {
    async pushMessageWithRequestId(userId: string, _messages: unknown[], retryKey?: string) {
      const result = await send(userId, retryKey)
      return { data: {}, requestId: result.requestId }
    },
  } as unknown as LineClient
}

const noPause = async () => undefined

describe('リマインダ配信の実行記録', () => {
  it('未来の通を送らずqueuedで先に記録し、予定件数と次回日時を出せる', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw, { offsetMinutes: 60 })
    let pushCount = 0
    const client = makeClient(async () => {
      pushCount++
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(result).toEqual({ succeeded: 0, skipped: 0, retrying: 0, failed: 0 })
    expect(pushCount).toBe(0)
    expect(raw.prepare(
      `SELECT status, scheduled_at, attempt_count FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'queued',
      scheduled_at: '2026-08-28T11:00:00.000Z',
      attempt_count: 0,
    })
    expect(raw.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'active' })
  })

  it('LINE送信・成功履歴・本文ログを同じ1回として残し、次のcronで二重送信しない', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const pushes: Array<{ userId: string; retryKey: string | undefined }> = []
    const client = makeClient(async (userId, retryKey) => {
      pushes.push({ userId, retryKey })
      return { requestId: 'line-request-1' }
    })
    const now = new Date('2026-08-28T09:00:00.000Z')

    const first = await processReminderDeliveries(db, client, {
      now,
      pause: noPause,
      resolveClient: async () => client,
    })
    const second = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:01:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(first).toEqual({ succeeded: 1, skipped: 0, retrying: 0, failed: 0 })
    expect(second).toEqual({ succeeded: 0, skipped: 0, retrying: 0, failed: 0 })
    expect(pushes).toHaveLength(1)
    expect(pushes[0].userId).toBe('U-friend-1')
    expect(pushes[0].retryKey).toMatch(/^[0-9a-f-]{36}$/)

    expect(raw.prepare(
      `SELECT status, attempt_count, line_request_id
         FROM reminder_delivery_runs`,
    ).get()).toEqual({ status: 'succeeded', attempt_count: 1, line_request_id: 'line-request-1' })
    expect(raw.prepare(
      `SELECT content, source, delivery_type, line_account_id FROM messages_log`,
    ).get()).toEqual({
      content: 'ご来店をお待ちしています',
      source: 'reminder',
      delivery_type: 'push',
      line_account_id: 'account-1',
    })
    expect(raw.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'completed' })
  })

  it('一時失敗は1分後に同じLINE再送キーで送り直し、成功後は止まる', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const retryKeys: string[] = []
    let attempts = 0
    const client = makeClient(async (_userId, retryKey) => {
      retryKeys.push(retryKey ?? '')
      attempts++
      if (attempts === 1) throw new Error('LINE API error: 500')
      return { requestId: 'line-request-after-retry' }
    })

    const failed = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })
    const tooEarly = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:59.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })
    const retried = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:01:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(failed).toEqual({ succeeded: 0, skipped: 0, retrying: 1, failed: 0 })
    expect(tooEarly).toEqual({ succeeded: 0, skipped: 0, retrying: 0, failed: 0 })
    expect(retried).toEqual({ succeeded: 1, skipped: 0, retrying: 0, failed: 0 })
    expect(retryKeys).toHaveLength(2)
    expect(retryKeys[1]).toBe(retryKeys[0])
    expect(raw.prepare(
      `SELECT status, attempt_count, retry_cycle_attempt_count, line_request_id
         FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'succeeded',
      attempt_count: 2,
      retry_cycle_attempt_count: 2,
      line_request_id: 'line-request-after-retry',
    })
  })

  it('ブロック済みの友だちは送らず、理由を残して登録を終える', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw, { isFollowing: false })
    let pushCount = 0
    const client = makeClient(async () => {
      pushCount++
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(result).toEqual({ succeeded: 0, skipped: 1, retrying: 0, failed: 0 })
    expect(pushCount).toBe(0)
    expect(raw.prepare(
      `SELECT status, last_error_code, last_error_message FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'skipped',
      last_error_code: 'friend_not_following',
      last_error_message: 'ブロックまたは友だち解除のため送信しませんでした。',
    })
    expect(raw.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'completed' })
  })

  it('LINEアカウントが決められない古い登録を、既定アカウントで誤送信しない', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    raw.prepare(`UPDATE reminders SET line_account_id = NULL WHERE id = 'reminder-1'`).run()
    raw.prepare(`UPDATE friends SET line_account_id = NULL WHERE id = 'friend-1'`).run()
    let pushCount = 0
    const fallbackClient = makeClient(async () => {
      pushCount++
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, fallbackClient, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
    })

    expect(result).toEqual({ succeeded: 0, skipped: 0, retrying: 0, failed: 1 })
    expect(pushCount).toBe(0)
    expect(raw.prepare(
      `SELECT status, last_error_code, last_error_message FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'permanent_failed',
      last_error_code: 'line_account_not_found',
      last_error_message: '送信に使うLINEアカウント設定を確認してください。',
    })
  })

  it('共通基盤どおり自動再試行を3回で止め、手動確認が必要な言葉へ変える', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const client = makeClient(async () => {
      throw new Error('LINE API error: 500 body=secret')
    })
    const times = [
      '2026-08-28T09:00:00.000Z',
      '2026-08-28T09:01:00.000Z',
      '2026-08-28T09:06:00.000Z',
      '2026-08-28T09:36:00.000Z',
    ]

    for (const time of times) {
      await processReminderDeliveries(db, client, {
        now: new Date(time),
        pause: noPause,
        resolveClient: async () => client,
      })
    }

    expect(raw.prepare(
      `SELECT status, attempt_count, retry_cycle_attempt_count,
              last_error_code, last_error_message, next_retry_at
         FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'permanent_failed',
      attempt_count: 4,
      retry_cycle_attempt_count: 4,
      last_error_code: 'retry_exhausted',
      last_error_message: '自動再試行の上限に達しました。LINE連携を確認し、必要なら手動で再試行してください。',
      next_retry_at: null,
    })
    expect(raw.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'completed' })
  })

  it('LINEの状態を、秘密の本文を出さず運用者向けの言葉へ変える', () => {
    expect(classifyReminderDeliveryError(new Error('LINE API error: 429 body=secret'))).toEqual({
      code: 'line_rate_limited',
      message: 'LINE側の送信上限に達しました。時間を置いて再試行します。',
      retryable: true,
    })
    expect(classifyReminderDeliveryError(new Error('LINE API error: 401 token=secret'))).toEqual({
      code: 'line_authentication_failed',
      message: 'LINE連携の認証を確認してください。',
      retryable: false,
    })
    expect(classifyReminderDeliveryError(new Error('LINE Harness proxy error: 500 — token=secret'))).toEqual({
      code: 'line_temporary_failure',
      message: 'LINEへの送信に一時的に失敗しました。自動で再試行します。',
      retryable: true,
    })
    expect(classifyReminderDeliveryError(new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND'))).toEqual({
      code: 'line_account_not_found',
      message: '送信に使うLINEアカウント設定を確認してください。',
      retryable: false,
    })
  })

  it('429ではLINEのRetry-Afterを既定の1分より優先する', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const client = makeClient(async () => {
      throw Object.assign(new Error('LINE API error: 429'), {
        status: 429,
        retryAfter: '120',
      })
    })

    await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(raw.prepare(
      `SELECT status, next_retry_at FROM reminder_delivery_runs`,
    ).get()).toEqual({
      status: 'retry_wait',
      next_retry_at: '2026-08-28T09:02:00.000Z',
    })
  })
})
