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

  it('課金の状態で配信が止まっている統括は送らず、予約は残す（プランを選べば続きから届く）', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const pushes: string[] = []
    const client = makeClient(async (userId) => {
      pushes.push(userId)
      return { requestId: 'line-request-1' }
    })
    const now = new Date('2026-08-28T09:00:00.000Z')

    const held = await processReminderDeliveries(db, client, {
      now,
      pause: noPause,
      resolveClient: async () => client,
      sendPermission: async () => ({ allowed: false, reason: '無料トライアルが終了', tenantId: 't', state: 'trial_expired' }),
    })
    expect(held.succeeded).toBe(0)
    expect(held.skipped).toBeGreaterThan(0)
    expect(pushes).toHaveLength(0)
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM reminder_delivery_runs`).get()).toEqual({ n: 0 })

    const resumed = await processReminderDeliveries(db, client, {
      now,
      pause: noPause,
      resolveClient: async () => client,
      sendPermission: async () => ({ allowed: true, reason: null, tenantId: 't', state: 'active' }),
    })
    expect(resumed.succeeded).toBe(1)
    expect(pushes).toEqual(['U-friend-1'])
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

  it('取消と競合した通は送らず止める (claimed 後の取消も送らない)', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    insertFriend(raw, 'friend-2', {
      line_user_id: 'U-friend-2',
      line_account_id: 'account-1',
      display_name: '佐藤たろう',
    })
    raw.prepare(
      `INSERT INTO friend_reminders
         (id, friend_id, reminder_id, target_date, status)
       VALUES ('enrollment-2', 'friend-2', 'reminder-1', '2026-08-28T10:00:00.000Z', 'active')`,
    ).run()
    const pushes: string[] = []
    const client = makeClient(async (userId) => {
      pushes.push(userId)
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      // 2件目の claim の割り込みで取消が入った想定。claim が原子的に拒否する。
      pause: async () => {
        await db.prepare(
          `UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = 'enrollment-2'`,
        ).bind('2026-08-28T09:00:00.000Z').run()
      },
      resolveClient: async () => client,
    })

    expect(pushes).toEqual(['U-friend-1'])
    // claim 拒否は握っていないため skipped に数えない。送らず止める約束は同じ。
    expect(result).toEqual({ succeeded: 1, skipped: 0, retrying: 0, failed: 0 })
    expect(raw.prepare(
      `SELECT status FROM reminder_delivery_runs WHERE friend_reminder_id = 'enrollment-2'`,
    ).get()).toEqual({ status: 'cancelled' })
    expect(raw.prepare(
      `SELECT status FROM friend_reminders WHERE id = 'enrollment-2'`,
    ).get()).toEqual({ status: 'cancelled' })
  })

  it('active確認後・push直前の取消でも送らない (送信直前の原子検証)', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const pushes: string[] = []
    const client = makeClient(async (userId) => {
      pushes.push(userId)
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      // claim 直後の active 確認を通ってから、push 直前に利用者が取消した想定。
      // 旧実装はこの窓で送信していた。新実装は送らず止める。
      resolveClient: async (_accountId, fallback) => {
        await db.prepare(
          `UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = 'enrollment-1'`,
        ).bind('2026-08-28T09:00:00.000Z').run()
        return fallback
      },
    })

    expect(pushes).toEqual([])
    expect(result).toEqual({ succeeded: 0, skipped: 1, retrying: 0, failed: 0 })
    expect(raw.prepare(
      `SELECT status FROM reminder_delivery_runs WHERE friend_reminder_id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'cancelled' })
  })

  it('送信権の取得後に取消が確定しても送らない (検証後注入)', async () => {
    const { db, raw } = createTestD1()
    seedReminder(raw)
    const pushes: string[] = []
    const client = makeClient(async (userId) => {
      pushes.push(userId)
      return { requestId: null }
    })

    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
      // 1回目の検証を通った直後に取消を確定させる。
      // 旧実装 (再検証なし) はこの窓で送信していた。
      beforePush: async () => {
        await db.prepare(
          `UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = 'enrollment-1'`,
        ).bind('2026-08-28T09:00:00.000Z').run()
        await db.prepare(
          `UPDATE reminder_delivery_runs
              SET status = 'cancelled', completed_at = ?, updated_at = ?
            WHERE friend_reminder_id = 'enrollment-1' AND status = 'claimed'`,
        ).bind('2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z').run()
      },
    })

    expect(pushes).toEqual([])
    expect(result).toEqual({ succeeded: 0, skipped: 1, retrying: 0, failed: 0 })
    expect(raw.prepare(
      `SELECT status FROM reminder_delivery_runs WHERE friend_reminder_id = 'enrollment-1'`,
    ).get()).toEqual({ status: 'cancelled' })
    expect(raw.prepare(
      `SELECT COUNT(*) AS c FROM friend_reminder_deliveries WHERE friend_reminder_id = 'enrollment-1'`,
    ).get()).toEqual({ c: 0 })
  })
})
