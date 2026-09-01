/*
 * シナリオのアクション。
 *
 * Lステップの「アクション設定」にあたる。発火する場所が3つある。
 *   step_sent          … その通を送ったあと
 *   scenario_completed … 最終コンテンツを配り終えたあと
 *   choice_selected    … 質問の選択肢が押されたとき
 *
 * どこから呼んでも同じ形で動かせるように、実行はこの1か所に置く。
 * 配信の本流（step-delivery）から呼ばれるので、**1つのアクションが失敗しても
 * 残りと配信そのものは続ける**。タグが1つ付かなかったせいでメッセージが
 * 止まるほうが、運用上はよほど困る。
 */
import { addTagToFriend, removeTagFromFriend, enrollFriendInScenario, jstNow } from '@line-crm/db'
import { matchesCondition, parseCondition } from './segment-query.js'

export type ScenarioActionHook = 'step_sent' | 'scenario_completed' | 'choice_selected'

export type ScenarioActionType =
  | 'tag'
  | 'friend_field'
  | 'support_mark'
  | 'scenario'
  | 'common_var'

export interface ScenarioActionRow {
  id: string
  scenario_id: string
  hook: ScenarioActionHook
  step_id: string | null
  choice_index: number | null
  sort_order: number
  action_type: ScenarioActionType
  config_json: string
  condition_json: string | null
  repeat_on_refire: number
}

/** config_json の形。action_type ごとに違う。 */
export interface TagActionConfig {
  op: 'add' | 'remove'
  tagIds: string[]
  /** タグフォルダを指定したとき、その中のタグを全部対象にする。 */
  folderId?: string | null
}
export interface FriendFieldActionConfig {
  fieldId: string
  op: 'set' | 'add' | 'sub' | 'clear'
  value: string
}
export interface SupportMarkActionConfig {
  /** null なら対応マークを外す。 */
  markId: string | null
}
export interface ScenarioActionConfig {
  op: 'start' | 'stop' | 'resume_previous'
  scenarioId?: string | null
  /**
   * start のとき、すでに読んだことがある人をどこから始めるか。
   *   from_start … 最初から
   *   from_read  … 読んだところから（再開）
   */
  restart?: 'from_start' | 'from_read'
  /** start のとき、いま読んでいるシナリオを控えて後で戻せるようにする。 */
  rememberPrevious?: boolean
}
export interface CommonVarActionConfig {
  varKey: string
  op: 'add' | 'sub'
  value: string
}

/**
 * 中身が埋まっているか。
 *
 * 画面はカードを1枚置いてから埋める作りなので、**埋まっていない状態でも
 * 保存できる**。そのまま実行すると「タグを1つも指定していないタグ操作」が
 * 黙って何もしないだけになり、設定したつもりで効いていないことに
 * 気づけない。実行の直前でここを見て、飛ばしたことをログに残す。
 *
 * 画面側もこれと同じ判定で「未完成」と出す（API が complete を返す）。
 */
export function isScenarioActionComplete(actionType: string, config: unknown): boolean {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return false
  const c = config as Record<string, unknown>
  switch (actionType) {
    case 'tag':
      return (
        (c.op === 'add' || c.op === 'remove') &&
        ((Array.isArray(c.tagIds) && c.tagIds.length > 0) ||
          (typeof c.folderId === 'string' && c.folderId !== ''))
      )
    case 'friend_field':
      return (
        typeof c.fieldId === 'string' &&
        c.fieldId !== '' &&
        ['set', 'add', 'sub', 'clear'].includes(String(c.op))
      )
    case 'support_mark':
      // null は「対応マークを外す」という意味のある指定。
      return c.markId === null || (typeof c.markId === 'string' && c.markId !== '')
    case 'scenario':
      if (c.op === 'resume_previous') return true
      if (c.op === 'stop') return true
      return c.op === 'start' && typeof c.scenarioId === 'string' && c.scenarioId !== ''
    case 'common_var':
      return (
        typeof c.varKey === 'string' && c.varKey !== '' && (c.op === 'add' || c.op === 'sub')
      )
    default:
      return false
  }
}

export interface RunActionsInput {
  scenarioId: string
  hook: ScenarioActionHook
  friendId: string
  stepId?: string | null
  choiceIndex?: number | null
}

export interface RunActionsResult {
  /** 実行したアクションの数。 */
  executed: number
  /** 条件に合わずに飛ばした数。 */
  skippedByCondition: number
  /** 「2回目以降は実行しない」で飛ばした数。 */
  skippedByOnce: number
  /** 失敗した数。失敗しても配信は続ける。 */
  failed: number
  /** 中身が埋まっていないため飛ばした数。 */
  skippedIncomplete: number
  /**
   * このアクションでシナリオの購読状態を触ったか。
   * 呼び出し側（step-delivery）が、そのあとの進行判断に使う。
   */
  scenarioTouched: boolean
}

export async function loadScenarioActions(
  db: D1Database,
  input: RunActionsInput,
): Promise<ScenarioActionRow[]> {
  // step_id / choice_index は NULL のことがあるので IS 比較にする。
  // = で比べると NULL 同士が一致せず、シナリオ完了時のアクションが
  // 1つも拾えなくなる。
  const rows = await db
    .prepare(
      `SELECT id, scenario_id, hook, step_id, choice_index, sort_order,
              action_type, config_json, condition_json, repeat_on_refire
         FROM scenario_actions
        WHERE scenario_id = ?
          AND hook = ?
          AND step_id IS ?
          AND choice_index IS ?
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(input.scenarioId, input.hook, input.stepId ?? null, input.choiceIndex ?? null)
    .all<ScenarioActionRow>()
  return rows.results ?? []
}

/**
 * アクションを順に実行する。
 *
 * 並び順は画面で決めた順。タグを付けてから、そのタグを条件にした次の
 * アクションを動かす、という書き方ができるように、**逐次**で実行する。
 * 並列にすると同じ画面の見た目どおりに動かない。
 */
export async function runScenarioActions(
  db: D1Database,
  input: RunActionsInput,
): Promise<RunActionsResult> {
  let actions: ScenarioActionRow[]
  try {
    actions = await loadScenarioActions(db, input)
  } catch (err) {
    console.error('[scenario-actions] failed to load actions', err)
    return emptyActionsResult()
  }
  return runActionRows(db, actions, input.friendId)
}

function emptyActionsResult(): RunActionsResult {
  return {
    executed: 0,
    skippedByCondition: 0,
    skippedByOnce: 0,
    failed: 0,
    skippedIncomplete: 0,
    scenarioTouched: false,
  }
}

/**
 * 並べたアクションを順に実行する。
 *
 * シナリオは `scenario_actions` の行を読んでここへ渡す。自動応答は
 * `auto_replies.actions_json` を読んで同じ形に組み立てて渡す。**実行そのものは
 * 1か所しかない。** 呼び出し元ごとに実装を分けると、タグ操作の細かい挙動
 * （フォルダ指定、条件付き、1回だけ）がすぐに食い違う。
 *
 * 並び順は画面で決めた順のまま逐次で動かす。タグを付けてから、そのタグを
 * 条件にした次のアクションを動かす、という書き方ができるようにするため。
 * 並列にすると画面の見た目どおりに動かない。
 *
 * 1つ失敗しても残りは続ける。タグが1つ付かなかったせいでメッセージが
 * 止まるほうが、運用上はよほど困る。
 */
export async function runActionRows(
  db: D1Database,
  actions: ScenarioActionRow[],
  friendId: string,
): Promise<RunActionsResult> {
  const result = emptyActionsResult()
  if (actions.length === 0) return result

  const input = { friendId }

  for (const action of actions) {
    try {
      /*
       * 中身が埋まっていないアクションは実行しない。
       *
       * 「タグを1つも選んでいないタグ操作」を実行しても何も起きないが、
       * 設定したつもりで効いていないことに気づけない。飛ばしたことを
       * 残しておけば、あとから追える。
       */
      let parsedConfig: unknown
      try {
        parsedConfig = JSON.parse(action.config_json)
      } catch {
        console.error(`[scenario-actions] unreadable config action=${action.id} — skipped`)
        result.failed++
        continue
      }
      if (!isScenarioActionComplete(action.action_type, parsedConfig)) {
        console.warn(
          `[scenario-actions] incomplete action=${action.id} type=${action.action_type} — skipped`,
        )
        result.skippedIncomplete++
        continue
      }

      if (action.repeat_on_refire === 0) {
        const fired = await db
          .prepare(`SELECT 1 AS ok FROM scenario_action_fires WHERE action_id = ? AND friend_id = ?`)
          .bind(action.id, input.friendId)
          .first<{ ok: number }>()
        if (fired) {
          result.skippedByOnce++
          continue
        }
      }

      const condition = parseCondition(action.condition_json)
      if (action.condition_json && !condition) {
        // 保存されている条件が読めない。全員に実行するより、飛ばして
        // ログに残すほうが安全側。
        console.error(`[scenario-actions] unreadable condition action=${action.id} — skipped`)
        result.failed++
        continue
      }
      if (!(await matchesCondition(db, input.friendId, condition))) {
        result.skippedByCondition++
        continue
      }

      const touched = await executeAction(db, action, input.friendId)
      if (touched) result.scenarioTouched = true
      result.executed++

      if (action.repeat_on_refire === 0) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO scenario_action_fires (action_id, friend_id, fired_at) VALUES (?, ?, ?)`,
          )
          .bind(action.id, input.friendId, jstNow())
          .run()
      }
    } catch (err) {
      // 1つ失敗しても残りは続ける。配信も止めない。
      console.error(`[scenario-actions] action=${action.id} type=${action.action_type} failed`, err)
      result.failed++
    }
  }

  return result
}

/** @returns シナリオの購読状態を触ったか。 */
async function executeAction(
  db: D1Database,
  action: ScenarioActionRow,
  friendId: string,
): Promise<boolean> {
  const config = JSON.parse(action.config_json) as unknown

  switch (action.action_type) {
    case 'tag': {
      const c = config as TagActionConfig
      const tagIds = await resolveTagIds(db, c)
      for (const tagId of tagIds) {
        if (c.op === 'remove') await removeTagFromFriend(db, friendId, tagId)
        else await addTagToFriend(db, friendId, tagId)
      }
      return false
    }

    case 'friend_field': {
      await applyFriendField(db, friendId, config as FriendFieldActionConfig)
      return false
    }

    case 'support_mark': {
      const c = config as SupportMarkActionConfig
      await db
        .prepare(`UPDATE friends SET support_mark_id = ?, updated_at = ? WHERE id = ?`)
        .bind(c.markId ?? null, jstNow(), friendId)
        .run()
      return false
    }

    case 'scenario': {
      await runScenarioOp(db, friendId, action.scenario_id, config as ScenarioActionConfig)
      return true
    }

    case 'common_var': {
      await applyCommonVar(db, friendId, config as CommonVarActionConfig)
      return false
    }

    default: {
      const exhaustive: never = action.action_type
      throw new Error(`Unknown action type: ${String(exhaustive)}`)
    }
  }
}

/** タグフォルダ指定なら、その中のタグを全部返す。 */
async function resolveTagIds(db: D1Database, c: TagActionConfig): Promise<string[]> {
  const ids = new Set<string>(Array.isArray(c.tagIds) ? c.tagIds : [])
  if (c.folderId) {
    const rows = await db
      .prepare(`SELECT id FROM tags WHERE group_id = ?`)
      .bind(c.folderId)
      .all<{ id: string }>()
    for (const row of rows.results ?? []) ids.add(row.id)
  }
  return [...ids]
}

/**
 * 友だち情報欄を書き換える。
 *
 * 加算・減算は数として扱う。値が数でなければ 0 とみなす。ここで例外にすると、
 * 1人ぶんの値が壊れているだけで以降の配信が全部止まる。
 */
async function applyFriendField(
  db: D1Database,
  friendId: string,
  c: FriendFieldActionConfig,
): Promise<void> {
  if (!c.fieldId) throw new Error('friend_field action requires fieldId')
  const now = jstNow()

  if (c.op === 'clear') {
    await db
      .prepare(`DELETE FROM friend_field_values WHERE friend_id = ? AND field_id = ?`)
      .bind(friendId, c.fieldId)
      .run()
    return
  }

  let next = c.value ?? ''
  if (c.op === 'add' || c.op === 'sub') {
    const current = await db
      .prepare(`SELECT value FROM friend_field_values WHERE friend_id = ? AND field_id = ?`)
      .bind(friendId, c.fieldId)
      .first<{ value: string | null }>()
    const base = Number(current?.value ?? 0)
    const delta = Number(c.value ?? 0)
    const safeBase = Number.isFinite(base) ? base : 0
    const safeDelta = Number.isFinite(delta) ? delta : 0
    next = String(c.op === 'add' ? safeBase + safeDelta : safeBase - safeDelta)
  }

  await db
    .prepare(
      `INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at)
       VALUES (?, ?, ?, 'scenario', ?)
       ON CONFLICT (friend_id, field_id)
       DO UPDATE SET value = excluded.value, updated_by = 'scenario', updated_at = excluded.updated_at`,
    )
    .bind(friendId, c.fieldId, next, now)
    .run()
}

/**
 * シナリオの購読を動かす。
 *
 * start のとき rememberPrevious が立っていれば、いま読んでいるシナリオを
 * 控えてから移す。控えた先が「1つ前のシナリオを再開」で戻ってくる。
 */
export async function runScenarioOp(
  db: D1Database,
  friendId: string,
  currentScenarioId: string,
  c: ScenarioActionConfig,
): Promise<void> {
  const now = jstNow()

  if (c.op === 'stop') {
    const targetId = c.scenarioId || currentScenarioId
    await db
      .prepare(
        `UPDATE friend_scenarios SET status = 'paused', updated_at = ?
          WHERE friend_id = ? AND scenario_id = ? AND status IN ('active','delivering')`,
      )
      .bind(now, friendId, targetId)
      .run()
    return
  }

  if (c.op === 'resume_previous') {
    await resumePreviousScenario(db, friendId, currentScenarioId)
    return
  }

  // start
  if (!c.scenarioId) throw new Error('scenario action requires scenarioId to start')

  let previousScenarioId: string | null = null
  if (c.rememberPrevious) {
    const running = await db
      .prepare(
        `SELECT scenario_id FROM friend_scenarios
          WHERE friend_id = ? AND scenario_id != ? AND status IN ('active','delivering')
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(friendId, c.scenarioId)
      .first<{ scenario_id: string }>()
    previousScenarioId = running?.scenario_id ?? null
    if (previousScenarioId) {
      await db
        .prepare(
          `UPDATE friend_scenarios SET status = 'paused', updated_at = ?
            WHERE friend_id = ? AND scenario_id = ? AND status IN ('active','delivering')`,
        )
        .bind(now, friendId, previousScenarioId)
        .run()
    }
  }

  // 読み終えた行が残っていると部分UNIQUE索引には触れないが、
  // 「最初から」を選んだときに読了済の行が邪魔をする。先に消す。
  if (c.restart !== 'from_read') {
    await db
      .prepare(`DELETE FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status = 'completed'`)
      .bind(friendId, c.scenarioId)
      .run()
  } else {
    // 「読んだところから」。止まっている行があれば起こすだけで済む。
    const paused = await db
      .prepare(
        `SELECT id FROM friend_scenarios
          WHERE friend_id = ? AND scenario_id = ? AND status = 'paused' LIMIT 1`,
      )
      .bind(friendId, c.scenarioId)
      .first<{ id: string }>()
    if (paused) {
      await db
        .prepare(
          `UPDATE friend_scenarios
              SET status = 'active', previous_scenario_id = COALESCE(?, previous_scenario_id), updated_at = ?
            WHERE id = ?`,
        )
        .bind(previousScenarioId, now, paused.id)
        .run()
      return
    }
  }

  const enrolled = await enrollFriendInScenario(db, friendId, c.scenarioId)
  if (enrolled && previousScenarioId) {
    await db
      .prepare(`UPDATE friend_scenarios SET previous_scenario_id = ? WHERE id = ?`)
      .bind(previousScenarioId, enrolled.id)
      .run()
  }
}

/**
 * 割り込む前に読んでいたシナリオへ戻す。
 *
 * 戻り先は friend_scenarios.previous_scenario_id に控えてある。控えが無ければ
 * 何もしない。**適当なシナリオを選んで再開しない**。意図しない配信が始まる。
 */
export async function resumePreviousScenario(
  db: D1Database,
  friendId: string,
  currentScenarioId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT previous_scenario_id FROM friend_scenarios
        WHERE friend_id = ? AND scenario_id = ?
        ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(friendId, currentScenarioId)
    .first<{ previous_scenario_id: string | null }>()
  const previousId = row?.previous_scenario_id ?? null
  if (!previousId) return false

  const updated = await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
        WHERE friend_id = ? AND scenario_id = ? AND status = 'paused'`,
    )
    .bind(jstNow(), friendId, previousId)
    .run()
  return (updated.meta?.changes ?? 0) > 0
}

/** 共通情報の加算・減算。在庫や残席のような、店ぜんたいで1つの数に使う。 */
async function applyCommonVar(
  db: D1Database,
  friendId: string,
  c: CommonVarActionConfig,
): Promise<void> {
  if (!c.varKey) throw new Error('common_var action requires varKey')
  const row = await db
    .prepare(
      `SELECT cv.value
         FROM common_vars cv
         JOIN friends f ON f.line_account_id = cv.line_account_id
        WHERE f.id = ? AND cv.var_key = ?`,
    )
    .bind(friendId, c.varKey)
    .first<{ value: string | null }>()
  if (!row) throw new Error(`common_var not found: ${c.varKey}`)
  const base = Number(row.value ?? 0)
  const delta = Number(c.value ?? 0)
  const safeBase = Number.isFinite(base) ? base : 0
  const safeDelta = Number.isFinite(delta) ? delta : 0
  const next = c.op === 'add' ? safeBase + safeDelta : safeBase - safeDelta
  await db
    .prepare(
      `UPDATE common_vars SET value = ?, updated_at = ?
        WHERE var_key = ?
          AND line_account_id = (SELECT line_account_id FROM friends WHERE id = ?)`,
    )
    .bind(String(next), jstNow(), c.varKey, friendId)
    .run()
}
