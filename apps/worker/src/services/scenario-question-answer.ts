/*
 * 質問メッセージの選択肢が押されたときの処理。
 *
 * webhook の postback 経路から呼ぶ。押された選択肢に紐づく
 *   返信 / タグ / 友だち情報 / シナリオ操作 / アクション
 * をこの順で行う。返信を最後にしないのは、タグ付けに失敗しても返信は
 * 返したいため。押したのに無反応、が利用者からいちばん困る。
 *
 * 読む先は**購読が固定している公開版の写し**（#644）。live の
 * scenario_steps / scenario_actions は読まない。押されたときに live を
 * 読むと、公開後に直した返信・タグ・遷移・アクションが、旧版のまま進んで
 * いる人の回答へ混入する。下書きの通を消したあとは、そもそも引けない。
 *
 * この変更より前に送った質問（`sq:<下書き通ID>:<番号>`）がまだトークに
 * 残っている。旧形の押下も受け取り、その人が固定している版の写しへ
 * 繋ぎ直してから実行する。繋ぎ先が無いときだけ live を読む。
 */
import {
  addTagToFriend,
  removeTagFromFriend,
  getPinnedScenarioStep,
  isResourceInScenarioAccount,
  parseScenarioVersionActions,
  parseScenarioVersionSteps,
  jstNow,
  type PinnedScenarioAction,
  type ScenarioVersion,
} from '@line-crm/db'
import type { LineClient } from '@line-crm/line-sdk'
import {
  parseQuestion,
  hasAnsweredBefore,
  DEFAULT_REPEAT_REPLY,
  buildQuestionPostbackData,
  type QuestionStepRef,
  type ScenarioQuestionChoice,
} from './scenario-question.js'
import { runScenarioActions, runPinnedScenarioActions } from './scenario-actions.js'

interface StepRow {
  id: string
  scenario_id: string
  question_json: string | null
}

export interface HandleQuestionAnswerInput {
  /** 押されたボタンがどの形の通IDを載せていたか。省略時は下書き（旧形）。 */
  kind?: 'version' | 'live'
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

/**
 * 押された通を1つに決める。
 *
 * `source` が `version` なら、質問文・選択肢・アクションはすべて版の写し
 * から取る。`live` は版がまだ無い環境のための逃げ道で、ここへ落ちるのは
 * 移行前のデータだけ。
 */
interface ResolvedAnswerTarget {
  source: 'version' | 'live'
  scenarioId: string
  scenarioAccountId: string | null
  questionJson: string | null
  /** 押下の記録に使う形（押されたボタンが載せていた形）。 */
  postbackRef: QuestionStepRef
  /** 同じ通を指す別の形。版へ移す前後で「2度目」を数え落とさないため。 */
  alsoMatchRef: QuestionStepRef | null
  /** messages_log.scenario_step_id。live の通が残っているときだけ入れる。 */
  logLiveStepId: string | null
  /** messages_log.scenario_version_step_id。 */
  logVersionStepId: string | null
  /** 版に固定されたアクション。live を読まないための写し。 */
  pinnedActions: PinnedScenarioAction[] | null
  versionStepId: string | null
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

  const target = await resolveAnswerTarget(db, friend.id, input)
  if (!target) return result

  const question = parseQuestion(target.questionJson)
  if (!question) return result

  const choice = question.choices[input.choiceIndex]
  if (!choice) return result

  result.handled = true

  // 記録より先に見る。記録したあとに数えると、いま押したぶんが混ざって
  // 1回目が2回目に見える。
  const repeatScope = question.tapMode === 'single' ? null : input.choiceIndex
  const answered = await hasAnsweredBefore(
    db,
    friend.id,
    target.postbackRef,
    repeatScope,
    target.alsoMatchRef,
  )
  result.repeat = answered

  await logPostback(db, friend.id, input.choiceIndex, target, input.lineAccountId ?? null)

  if (answered) {
    // 2度目。返すだけで、タグもシナリオも動かさない。
    const text = choice.repeatReply && choice.repeatReply.trim() !== ''
      ? choice.repeatReply
      : DEFAULT_REPEAT_REPLY
    result.replyTokenConsumed = await sendReply(lineClient, friend, replyToken, text)
    return result
  }

  await applyChoiceSideEffects(db, friend.id, target, choice)

  try {
    if (target.pinnedActions) {
      await runPinnedScenarioActions(db, {
        actions: target.pinnedActions,
        hook: 'choice_selected',
        friendId: friend.id,
        versionStepId: target.versionStepId,
        choiceIndex: input.choiceIndex,
        accountId: target.scenarioAccountId,
      })
    } else {
      await runScenarioActions(db, {
        scenarioId: target.scenarioId,
        hook: 'choice_selected',
        friendId: friend.id,
        stepId: target.logLiveStepId ?? input.stepId,
        choiceIndex: input.choiceIndex,
      })
    }
  } catch (err) {
    console.error('[scenario-question] actions failed', err)
  }

  if (choice.reply && choice.reply.trim() !== '') {
    result.replyTokenConsumed = await sendReply(lineClient, friend, replyToken, choice.reply)
  }

  return result
}

async function resolveAnswerTarget(
  db: D1Database,
  friendId: string,
  input: HandleQuestionAnswerInput,
): Promise<ResolvedAnswerTarget | null> {
  if (input.kind === 'version') {
    const hit = await getPinnedScenarioStep(db, input.stepId)
    if (!hit) return null
    return buildVersionTarget(db, hit.version, {
      versionStepId: hit.step.id,
      liveStepId: hit.step.live_step_id,
      questionJson: hit.step.question_json,
      postbackRef: { kind: 'version', stepId: hit.step.id },
      alsoMatchRef: hit.step.live_step_id
        ? { kind: 'live', stepId: hit.step.live_step_id }
        : null,
    })
  }

  // 旧形の押下。この人が固定している版へ繋ぎ直す。
  const step = await db
    .prepare(`SELECT id, scenario_id, question_json FROM scenario_steps WHERE id = ?`)
    .bind(input.stepId)
    .first<StepRow>()
  if (!step) return null

  const pinned = await db
    .prepare(
      `SELECT sv.*
         FROM friend_scenarios fs
         JOIN scenario_versions sv ON sv.id = fs.published_version_id
        WHERE fs.friend_id = ? AND fs.scenario_id = ?
        ORDER BY fs.updated_at DESC
        LIMIT 1`,
    )
    .bind(friendId, step.scenario_id)
    .first<ScenarioVersion>()

  if (pinned) {
    const versionStep = parseScenarioVersionSteps(pinned).find(
      (s) => s.live_step_id === step.id,
    )
    if (versionStep) {
      return buildVersionTarget(db, pinned, {
        versionStepId: versionStep.id,
        liveStepId: step.id,
        questionJson: versionStep.question_json,
        // 押されたボタンは旧形を載せている。記録も押された形のまま残す。
        postbackRef: { kind: 'live', stepId: step.id },
        alsoMatchRef: { kind: 'version', stepId: versionStep.id },
      })
    }
  }

  // 版がまだ無い（移行前）。従来どおり live を読む。
  const account = await db
    .prepare(`SELECT line_account_id FROM scenarios WHERE id = ?`)
    .bind(step.scenario_id)
    .first<{ line_account_id: string | null }>()
  return {
    source: 'live',
    scenarioId: step.scenario_id,
    scenarioAccountId: account?.line_account_id ?? null,
    questionJson: step.question_json,
    postbackRef: { kind: 'live', stepId: step.id },
    alsoMatchRef: null,
    logLiveStepId: step.id,
    logVersionStepId: null,
    pinnedActions: null,
    versionStepId: null,
  }
}

async function buildVersionTarget(
  db: D1Database,
  version: ScenarioVersion,
  parts: {
    versionStepId: string
    liveStepId: string | null
    questionJson: string | null
    postbackRef: QuestionStepRef
    alsoMatchRef: QuestionStepRef | null
  },
): Promise<ResolvedAnswerTarget> {
  const account = await db
    .prepare(`SELECT line_account_id FROM scenarios WHERE id = ?`)
    .bind(version.scenario_id)
    .first<{ line_account_id: string | null }>()
  // 外部キーを壊さないよう、live の通が残っているときだけ控えを入れる。
  const liveStepId = parts.liveStepId
    ? ((
        await db
          .prepare(`SELECT 1 AS ok FROM scenario_steps WHERE id = ?`)
          .bind(parts.liveStepId)
          .first<{ ok: number }>()
      )
        ? parts.liveStepId
        : null)
    : null
  return {
    source: 'version',
    scenarioId: version.scenario_id,
    scenarioAccountId: account?.line_account_id ?? null,
    questionJson: parts.questionJson,
    postbackRef: parts.postbackRef,
    alsoMatchRef: parts.alsoMatchRef,
    logLiveStepId: liveStepId,
    logVersionStepId: parts.versionStepId,
    pinnedActions: parseScenarioVersionActions(version),
    versionStepId: parts.versionStepId,
  }
}

async function logPostback(
  db: D1Database,
  friendId: string,
  choiceIndex: number,
  target: ResolvedAnswerTarget,
  lineAccountId: string | null,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, scenario_version_step_id, source, line_account_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, ?, ?, 'postback', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friendId,
        buildQuestionPostbackData(target.postbackRef, choiceIndex),
        target.logLiveStepId,
        target.logVersionStepId,
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
 *
 * タグと遷移先は、シナリオと同じ LINE 公式アカウントのものだけを通す。
 * ID を直接書けば他アカウントのタグを付けられる、という抜けを server 側で
 * 塞ぐ（画面で選べないだけでは足りない）。
 */
async function applyChoiceSideEffects(
  db: D1Database,
  friendId: string,
  target: ResolvedAnswerTarget,
  choice: ScenarioQuestionChoice,
): Promise<void> {
  const accountId = target.scenarioAccountId
  for (const tagId of choice.addTagIds ?? []) {
    try {
      if (!(await isResourceInScenarioAccount(db, 'tag', tagId, accountId))) {
        console.warn(`[scenario-question] cross-account tag=${tagId} — skipped`)
        continue
      }
      await addTagToFriend(db, friendId, tagId)
    } catch (err) {
      console.error('[scenario-question] add tag failed', err)
    }
  }
  for (const tagId of choice.removeTagIds ?? []) {
    try {
      if (!(await isResourceInScenarioAccount(db, 'tag', tagId, accountId))) {
        console.warn(`[scenario-question] cross-account tag=${tagId} — skipped`)
        continue
      }
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
      if (
        choice.scenario.scenarioId &&
        !(await isResourceInScenarioAccount(
          db,
          'scenario',
          choice.scenario.scenarioId,
          accountId,
        ))
      ) {
        console.warn(
          `[scenario-question] cross-account scenario=${choice.scenario.scenarioId} — skipped`,
        )
        return
      }
      const { runScenarioOp } = await import('./scenario-actions.js')
      await runScenarioOp(db, friendId, target.scenarioId, choice.scenario)
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
