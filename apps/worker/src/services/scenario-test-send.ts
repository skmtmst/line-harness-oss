/*
 * シナリオのテスト送信。
 *
 * 1通ぶん、または全通を、指定した友だちへ実際に送る。**購読の状態は一切
 * 触らない**。テストのつもりが本番の進行を動かしてしまうと、受け取る人の
 * 途中から次が届かなくなる。
 *
 * 送る中身は配信本番と同じ組み立てを通す。ここで別の組み立てを書くと、
 * テストでは出るのに本番で出ない（またはその逆）が起きる。
 */
import { getFriendById, resolveStepContent, jstNow, getLineAccountById } from '@line-crm/db'
import type { ScenarioStep } from '@line-crm/db'
import { LineClient } from '@line-crm/line-sdk'
import type { Message } from '@line-crm/line-sdk'
import { expandVariables, resolveMetadata, buildMessage } from './step-delivery.js'
import { resolveInterpolationExtra } from './interpolation-context.js'
import { parseQuestion, buildQuestionMessages } from './scenario-question.js'

export interface TestSendResult {
  ok: boolean
  error?: string
  /** 実際に送った通の数。 */
  sent: number
}

/** 1通ぶんを組み立てる。送信はしない（プレビューにも使える）。 */
export async function buildStepMessages(
  db: D1Database,
  step: ScenarioStep,
  friendId: string,
  workerUrl?: string,
): Promise<Message[]> {
  const friend = await getFriendById(db, friendId)
  if (!friend) throw new Error('friend not found')

  const resolved = await resolveStepContent(db, step)
  const meta = await resolveMetadata(db, {
    user_id: (friend as unknown as Record<string, string | null>).user_id,
    metadata: (friend as unknown as Record<string, string | null>).metadata,
  })
  const friendWithMeta = { ...friend, metadata: meta } as Parameters<typeof expandVariables>[1]
  const extra = await resolveInterpolationExtra(db, friend.id, resolved.messageContent)

  const question = parseQuestion(resolved.questionJson)
  if (question) {
    return buildQuestionMessages(
      {
        ...question,
        intro: question.intro
          ? expandVariables(question.intro, friendWithMeta, workerUrl, 'text', extra)
          : question.intro,
        text: expandVariables(question.text, friendWithMeta, workerUrl, 'text', extra),
      },
      step.id,
    )
  }

  const expanded = expandVariables(
    resolved.messageContent,
    friendWithMeta,
    workerUrl,
    resolved.messageType,
    extra,
  )
  return [buildMessage(resolved.messageType, expanded)]
}

/**
 * テスト送信する。
 *
 * URL の自動計測（auto-track）は通さない。テストのクリックが本番の集計に
 * 混ざると、あとから見分けられない。
 */
export async function testSendSteps(
  db: D1Database,
  fallbackClient: LineClient,
  steps: ScenarioStep[],
  friendId: string,
  scenarioAccountId: string | null,
  workerUrl?: string,
): Promise<TestSendResult> {
  const friend = await getFriendById(db, friendId)
  if (!friend) return { ok: false, error: '送り先の友だちが見つかりません。', sent: 0 }
  if (!friend.is_following) {
    return { ok: false, error: 'この友だちはブロック中のため送れません。', sent: 0 }
  }

  let client = fallbackClient
  const accountId = scenarioAccountId ?? friend.line_account_id
  if (accountId) {
    const account = await getLineAccountById(db, accountId)
    if (!account) return { ok: false, error: 'LINEアカウントの設定が見つかりません。', sent: 0 }
    client = new LineClient(account.channel_access_token)
  }

  let sent = 0
  for (const step of steps) {
    const messages = await buildStepMessages(db, step, friendId, workerUrl)
    await client.pushMessage(friend.line_user_id, messages)
    sent += messages.length

    // テスト送信も記録に残す。残さないと「送ったはずだが届いていない」の
    // 切り分けができない。source で本番と区別できるようにしておく。
    for (const message of messages) {
      const { messageToLogPayload } = await import('./step-delivery.js')
      const payload = messageToLogPayload(message)
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'scenario_test', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          friend.id,
          payload.messageType,
          payload.content,
          step.id,
          accountId ?? null,
          jstNow(),
        )
        .run()
    }
  }

  return { ok: true, sent }
}
