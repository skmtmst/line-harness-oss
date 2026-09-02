/*
 * 質問メッセージの選択肢が押されたときの処理。
 *
 * webhook の postback 経路から呼ぶ。押された選択肢に紐づく
 *   返信 / タグ / 友だち情報 / シナリオ操作 / アクション
 * をこの順で行う。返信を最後にしないのは、タグ付けに失敗しても返信は
 * 返したいため。押したのに無反応、が利用者からいちばん困る。
 */
import { addTagToFriend, removeTagFromFriend, jstNow } from '@line-crm/db'
import type { LineClient } from '@line-crm/line-sdk'
import {
  parseQuestion,
  hasAnsweredBefore,
  DEFAULT_REPEAT_REPLY,
  buildQuestionPostbackData,
  type ScenarioQuestionChoice,
} from './scenario-question.js'
import { runScenarioActions } from './scenario-actions.js'

interface StepRow {
  id: string
  scenario_id: string
  question_json: string | null
}

export interface HandleQuestionAnswerInput {
  stepId: string
  choiceIndex: number
  lineAccountId?: string | null
}

export interface HandleQuestionAnswerResult {
  handled: boolean
  /** 2度目以降の押下だったか。 */
  repeat: boolean
  /** replyToken を使ったか。呼び出し側が二重返信しないための目印。 */
  replyTokenConsumed: boolean
}

export async function handleQuestionAnswer(
  db: D1Database,
  lineClient: LineClient,
  friend: { id: string; line_user_id: string },
  input: HandleQuestionAnswerInput,
  replyToken: string | undefined,
): Promise<HandleQuestionAnswerResult> {
  const result: HandleQuestionAnswerResult = {
    handled: false,
    repeat: false,
    replyTokenConsumed: false,
  }

  const step = await db
    .prepare(`SELECT id, scenario_id, question_json FROM scenario_steps WHERE id = ?`)
    .bind(input.stepId)
    .first<StepRow>()
  if (!step) return result

  const question = parseQuestion(step.question_json)
  if (!question) return result

  const choice = question.choices[input.choiceIndex]
  if (!choice) return result

  result.handled = true

  // 記録より先に見る。記録したあとに数えると、いま押したぶんが混ざって
  // 1回目が2回目に見える。
  const repeatScope = question.tapMode === 'single' ? null : input.choiceIndex
  const answered = await hasAnsweredBefore(db, friend.id, step.id, repeatScope)
  result.repeat = answered

  await logPostback(db, friend.id, step.id, input.choiceIndex, input.lineAccountId ?? null)

  if (answered) {
    // 2度目。返すだけで、タグもシナリオも動かさない。
    const text = choice.repeatReply && choice.repeatReply.trim() !== ''
      ? choice.repeatReply
      : DEFAULT_REPEAT_REPLY
    result.replyTokenConsumed = await sendReply(lineClient, friend, replyToken, text)
    return result
  }

  await applyChoiceSideEffects(db, friend.id, step.scenario_id, choice)

  try {
    await runScenarioActions(db, {
      scenarioId: step.scenario_id,
      hook: 'choice_selected',
      friendId: friend.id,
      stepId: step.id,
      choiceIndex: input.choiceIndex,
    })
  } catch (err) {
    console.error('[scenario-question] actions failed', err)
  }

  if (choice.reply && choice.reply.trim() !== '') {
    result.replyTokenConsumed = await sendReply(lineClient, friend, replyToken, choice.reply)
  }

  return result
}

async function logPostback(
  db: D1Database,
  friendId: string,
  stepId: string,
  choiceIndex: number,
  lineAccountId: string | null,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, ?, 'postback', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friendId,
        buildQuestionPostbackData(stepId, choiceIndex),
        stepId,
        lineAccountId,
        jstNow(),
      )
      .run()
  } catch (err) {
    console.error('[scenario-question] failed to log postback', err)
  }
}

/**
 * 選択肢に直接ぶら下がっている操作。
 *
 * アクション設定（scenario_actions）とは別に、選択肢の欄として持っている
 * ぶん。Lステップも同じで、よく使う3つ（タグ追加・タグはずす・友だち情報）
 * だけは選択肢の中に置いてある。
 */
async function applyChoiceSideEffects(
  db: D1Database,
  friendId: string,
  scenarioId: string,
  choice: ScenarioQuestionChoice,
): Promise<void> {
  for (const tagId of choice.addTagIds ?? []) {
    try {
      await addTagToFriend(db, friendId, tagId)
    } catch (err) {
      console.error('[scenario-question] add tag failed', err)
    }
  }
  for (const tagId of choice.removeTagIds ?? []) {
    try {
      await removeTagFromFriend(db, friendId, tagId)
    } catch (err) {
      console.error('[scenario-question] remove tag failed', err)
    }
  }

  if (choice.field?.fieldId) {
    try {
      await db
        .prepare(
          `INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at)
           VALUES (?, ?, ?, 'scenario', ?)
           ON CONFLICT (friend_id, field_id)
           DO UPDATE SET value = excluded.value, updated_by = 'scenario', updated_at = excluded.updated_at`,
        )
        .bind(friendId, choice.field.fieldId, choice.field.value ?? '', jstNow())
        .run()
    } catch (err) {
      console.error('[scenario-question] set field failed', err)
    }
  }

  if (choice.behavior === 'scenario' && choice.scenario) {
    try {
      const { runScenarioOp } = await import('./scenario-actions.js')
      await runScenarioOp(db, friendId, scenarioId, choice.scenario)
    } catch (err) {
      console.error('[scenario-question] scenario op failed', err)
    }
  }
}

async function sendReply(
  lineClient: LineClient,
  friend: { line_user_id: string },
  replyToken: string | undefined,
  text: string,
): Promise<boolean> {
  try {
    if (replyToken) {
      await lineClient.replyMessage(replyToken, [{ type: 'text', text }])
      return true
    }
    await lineClient.pushMessage(friend.line_user_id, [{ type: 'text', text }])
    return false
  } catch (err) {
    console.error('[scenario-question] reply failed', err)
    return false
  }
}
