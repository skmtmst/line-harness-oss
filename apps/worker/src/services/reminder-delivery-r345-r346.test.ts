import { describe, expect, it } from 'vitest'

import type { LineClient } from '@line-crm/line-sdk'
import { enrollFriendInReminder } from '@line-crm/db'

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js'
import { processReminderDeliveries } from './reminder-delivery.js'

const noPause = async () => undefined

const TEMPLATE_A = 'こんにちは{{name}}さん、会場は会場Aです'
const TEMPLATE_B = '{{name}}さん、会場は会場Bです'

function seedTemplateReminder(raw: import('better-sqlite3').Database, templateContent: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '本店', 'token', 'secret')`,
  ).run()
  insertFriend(raw, 'friend-1', {
    line_user_id: 'U-friend-1',
    line_account_id: 'account-1',
    display_name: '田中さくら',
    is_following: 1,
  })
  raw.prepare(
    `INSERT INTO templates (id, name, message_type, message_content, published_version)
     VALUES ('tpl-1', '案内', 'text', ?, 1)`,
  ).run(templateContent)
  raw.prepare(
    `INSERT INTO template_versions (id, template_id, version_number, message_type, message_content)
     VALUES ('tplv-1', 'tpl-1', 1, 'text', ?)`,
  ).run(templateContent)
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
     VALUES ('reminder-1', '来店前のお知らせ', 'account-1', 1, 'manual', 'countdown', 'published')`,
  ).run()
  raw.prepare(
    `INSERT INTO reminder_steps
       (id, reminder_id, offset_minutes, message_type, message_content, template_id)
     VALUES ('step-1', 'reminder-1', -60, 'text', '控え', 'tpl-1')`,
  ).run()
}

/** テンプレートの公開（live行の更新＋版履歴の追加）と同じ状態にする。 */
function publishTemplateV2(raw: import('better-sqlite3').Database, content: string): void {
  raw.prepare(
    `UPDATE templates SET message_content = ?, published_version = 2 WHERE id = 'tpl-1'`,
  ).run(content)
  raw.prepare(
    `INSERT INTO template_versions (id, template_id, version_number, message_type, message_content)
     VALUES ('tplv-2', 'tpl-1', 2, 'text', ?)`,
  ).run(content)
}

interface CapturedPush {
  userId: string
  messages: Array<{ type: string; text: string }>
  retryKey: string | undefined
}

function makeCaptureClient(
  behavior: (n: number) => Promise<{ requestId: string | null }>,
): { client: LineClient; calls: CapturedPush[] } {
  const calls: CapturedPush[] = []
  const client = {
    async pushMessageWithRequestId(userId: string, messages: unknown[], retryKey?: string) {
      const n = calls.length
      const result = await behavior(n).finally(() => {
        calls.push({ userId, messages: messages as CapturedPush['messages'], retryKey })
      })
      return { data: {}, requestId: result.requestId }
    },
  } as unknown as LineClient
  return { client, calls }
}

function pushText(call: CapturedPush): string {
  return call.messages[0].text
}

describe('R345 受理された本文の保存', () => {
  it('再試行前に名前・テンプレートが変わっても、同じキーの再送と履歴は初回の本文のまま', async () => {
    const { db, raw } = createTestD1()
    seedTemplateReminder(raw, TEMPLATE_A)
    await enrollFriendInReminder(db, {
      friendId: 'friend-1',
      reminderId: 'reminder-1',
      targetDate: '2026-08-28T10:00:00.000Z',
    })
    const { client, calls } = makeCaptureClient(async (n) => {
      if (n === 0) throw new Error('fetch failed: network timeout')
      return { requestId: 'line-request-after-retry' }
    })

    const first = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })
    expect(first.retrying).toBe(1)
    expect(calls).toHaveLength(1)
    expect(pushText(calls[0])).toContain('会場A')

    // 再試行の前に、友だちの名前とテンプレートを変える（監査の再現条件）。
    raw.prepare(`UPDATE friends SET display_name = '佐藤はなこ' WHERE id = 'friend-1'`).run()
    publishTemplateV2(raw, TEMPLATE_B)

    const second = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:01:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })
    expect(second.succeeded).toBe(1)
    expect(calls).toHaveLength(2)
    // 同じ再試行キーで、初回と一字一句同じ要求を送る。
    expect(calls[1].retryKey).toBe(calls[0].retryKey)
    expect(calls[1].messages).toEqual(calls[0].messages)
    expect(pushText(calls[1])).toContain('田中さくら')
    expect(pushText(calls[1])).toContain('会場A')
    expect(pushText(calls[1])).not.toContain('会場B')
    // 履歴も受理された初回の本文を残す。
    expect(raw.prepare(`SELECT content FROM messages_log`).get()).toEqual({
      content: pushText(calls[0]),
    })
  })

  it('受理後に履歴保存まで届かなかった再試行は、保存した初回本文から履歴を回復する', async () => {
    const { db, raw } = createTestD1()
    seedTemplateReminder(raw, '確定本文A')
    await enrollFriendInReminder(db, {
      friendId: 'friend-1',
      reminderId: 'reminder-1',
      targetDate: '2026-08-28T10:00:00.000Z',
    })
    // 初回は送られて受理ずみだが、履歴の保存まで届かなかった実行行。
    raw.prepare(
      `INSERT INTO reminder_delivery_runs
         (id, reminder_id, friend_reminder_id, friend_id, reminder_step_id,
          scheduled_at, idempotency_key, line_retry_key, status,
          attempt_count, retry_cycle_attempt_count, next_retry_at, started_at,
          sent_message_type, sent_message_content, created_at, updated_at)
       VALUES ('run-1', 'reminder-1', 'enrollment-x', 'friend-1', 'step-1',
          '2026-08-28T09:00:00.000Z', 'idem-1', 'retry-key-1', 'retry_wait',
          1, 1, '2026-08-28T09:01:00.000Z', '2026-08-28T09:00:00.000Z',
          'text', '確定本文A', '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z')`,
    ).run()
    raw.prepare(`UPDATE friend_reminders SET id = 'enrollment-x' WHERE friend_id = 'friend-1'`).run()
    raw.prepare(`UPDATE friends SET display_name = '佐藤はなこ' WHERE id = 'friend-1'`).run()
    publishTemplateV2(raw, TEMPLATE_B)

    const { client, calls } = makeCaptureClient(async () => ({ requestId: 'line-request-retry' }))
    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:02:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(result.succeeded).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].retryKey).toBe('retry-key-1')
    expect(pushText(calls[0])).toBe('確定本文A')
    expect(raw.prepare(`SELECT content FROM messages_log`).get()).toEqual({
      content: '確定本文A',
    })
  })
})

describe('R346 登録時のテンプレート版の固定', () => {
  it('登録後にテンプレートを公開しても、初回は登録時の版で送る', async () => {
    const { db, raw } = createTestD1()
    seedTemplateReminder(raw, TEMPLATE_A)
    await enrollFriendInReminder(db, {
      friendId: 'friend-1',
      reminderId: 'reminder-1',
      targetDate: '2026-08-28T10:00:00.000Z',
    })
    // まだ一度も送っていない間にテンプレートだけ新しい版へ公開する。
    publishTemplateV2(raw, TEMPLATE_B)

    const { client, calls } = makeCaptureClient(async () => ({ requestId: 'line-request-1' }))
    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(result.succeeded).toBe(1)
    expect(calls).toHaveLength(1)
    expect(pushText(calls[0])).toContain('会場A')
    expect(pushText(calls[0])).not.toContain('会場B')
    expect(raw.prepare(`SELECT content FROM messages_log`).get()).toEqual({
      content: pushText(calls[0]),
    })
  })

  it('新しい版の公開後に登録した通知は、新しい版で送る（固定のしすぎを防ぐ）', async () => {
    const { db, raw } = createTestD1()
    seedTemplateReminder(raw, TEMPLATE_A)
    publishTemplateV2(raw, TEMPLATE_B)
    await enrollFriendInReminder(db, {
      friendId: 'friend-1',
      reminderId: 'reminder-1',
      targetDate: '2026-08-28T10:00:00.000Z',
    })

    const { client, calls } = makeCaptureClient(async () => ({ requestId: 'line-request-1' }))
    const result = await processReminderDeliveries(db, client, {
      now: new Date('2026-08-28T09:00:00.000Z'),
      pause: noPause,
      resolveClient: async () => client,
    })

    expect(result.succeeded).toBe(1)
    expect(calls).toHaveLength(1)
    expect(pushText(calls[0])).toContain('会場B')
  })
})
