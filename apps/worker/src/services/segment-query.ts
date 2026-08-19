/*
 * 友だちの絞り込み条件を SQL に組み立てる。
 *
 * この部品は4か所から呼ばれる。
 *   - 一斉配信の配信対象
 *   - シナリオ全体の配信対象
 *   - シナリオ1通ごとの配信対象
 *   - シナリオのアクション1つごとの実行条件
 *
 * 条件の形を1つにそろえてあるので、画面側も同じ部品で書ける。増やすときは
 * ここに1か所足せば4か所に効く。
 */

/** 友だち情報欄・共通情報で使う比較。 */
export type FieldOperator =
  | 'equals'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'not_equals'
  | 'not_contains'
  | 'gte'
  | 'gt'
  | 'lte'
  | 'lt'

export interface SegmentRule {
  type:
    | 'tag_exists'
    | 'tag_not_exists'
    | 'tag_all'
    | 'tag_not_all'
    | 'metadata_equals'
    | 'metadata_not_equals'
    | 'ref_code'
    | 'is_following'
    | 'scenario_subscribed'
    | 'name'
    | 'private_memo'
    | 'status_message'
    | 'registered_at'
    | 'support_mark'
    | 'is_hidden'
    | 'friend_field'
    | 'scenario_state'
    | 'form_answered'
    | 'last_reaction_at'
    | 'reaction_state'
  value: unknown
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
  /**
   * 入れ子のグループ。Lステップの「いずれか1つ以上を満たす必要がある条件
   * (or条件)」にあたる。親の operator でこの結果とつなぐ。
   *
   * 省略できる。以前の形（rules だけ）で保存された条件がそのまま動く。
   */
  groups?: SegmentCondition[]
}

/** 名前をどの欄から探すか。 */
const NAME_COLUMNS: Record<string, string> = {
  display: 'f.display_name',
  real: 'f.real_name',
  system: 'f.system_display_name',
}

/** 反応状態。messages_log の incoming をどう数えるか。 */
const REACTION_STATES = ['any', 'reply_or_postback', 'reply', 'postback', 'none'] as const
export type ReactionState = (typeof REACTION_STATES)[number]

function asString(value: unknown, ruleType: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${ruleType} rule requires a string value`)
  }
  return value
}

function asStringArray(value: unknown, ruleType: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${ruleType} rule requires an array of string IDs`)
  }
  if (value.length === 0) {
    throw new Error(`${ruleType} rule requires at least one ID`)
  }
  return value as string[]
}

function asRecord(value: unknown, ruleType: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${ruleType} rule requires an object value`)
  }
  return value as Record<string, unknown>
}

/**
 * 期間の条件。from / to はどちらも省略できるが、両方省略は受け付けない。
 * 「期間を指定したつもりで全員に一致する」事故を防ぐため。
 */
function buildDateRange(column: string, value: unknown, ruleType: string): { sql: string; bindings: unknown[] } {
  const v = asRecord(value, ruleType)
  const from = typeof v.from === 'string' && v.from !== '' ? v.from : null
  const to = typeof v.to === 'string' && v.to !== '' ? v.to : null
  if (!from && !to) {
    throw new Error(`${ruleType} rule requires at least one of from / to`)
  }
  const parts: string[] = []
  const bindings: unknown[] = []
  if (from) {
    parts.push(`${column} >= ?`)
    bindings.push(from)
  }
  if (to) {
    // 「〜まで」は、その日の終わりまでを含める。日付だけを渡されたときに
    // 当日ぶんが落ちると、指定した本人の期待とずれる。
    parts.push(`${column} <= ?`)
    bindings.push(to.length === 10 ? `${to}T23:59:59.999` : to)
  }
  return { sql: `(${parts.join(' AND ')})`, bindings }
}

/**
 * 値の比較。友だち情報欄で使う。
 *
 * 数値比較 (gte/gt/lte/lt) は CAST する。友だち情報欄の値は TEXT で持って
 * いるので、文字列のまま比較すると "10" < "9" になる。
 */
function buildValueComparison(
  valueExpr: string,
  op: FieldOperator,
  text: string,
): { sql: string; bindings: unknown[] } {
  switch (op) {
    case 'equals':
      return { sql: `${valueExpr} = ?`, bindings: [text] }
    case 'not_equals':
      return { sql: `(${valueExpr} IS NULL OR ${valueExpr} != ?)`, bindings: [text] }
    case 'contains':
      return { sql: `${valueExpr} LIKE ?`, bindings: [`%${text}%`] }
    case 'not_contains':
      return { sql: `(${valueExpr} IS NULL OR ${valueExpr} NOT LIKE ?)`, bindings: [`%${text}%`] }
    case 'exists':
      return { sql: `(${valueExpr} IS NOT NULL AND ${valueExpr} != '')`, bindings: [] }
    case 'not_exists':
      return { sql: `(${valueExpr} IS NULL OR ${valueExpr} = '')`, bindings: [] }
    case 'gte':
      return { sql: `CAST(${valueExpr} AS REAL) >= ?`, bindings: [Number(text)] }
    case 'gt':
      return { sql: `CAST(${valueExpr} AS REAL) > ?`, bindings: [Number(text)] }
    case 'lte':
      return { sql: `CAST(${valueExpr} AS REAL) <= ?`, bindings: [Number(text)] }
    case 'lt':
      return { sql: `CAST(${valueExpr} AS REAL) < ?`, bindings: [Number(text)] }
    default: {
      const exhaustive: never = op
      throw new Error(`Unknown operator: ${exhaustive}`)
    }
  }
}

/** 1つのルールを WHERE 句の断片にする。 */
function buildRuleClause(rule: SegmentRule): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []

  switch (rule.type) {
    case 'tag_exists': {
      bindings.push(asString(rule.value, 'tag_exists'))
      return {
        sql: `EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        bindings,
      }
    }

    case 'tag_not_exists': {
      bindings.push(asString(rule.value, 'tag_not_exists'))
      return {
        sql: `NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        bindings,
      }
    }

    /* 選択したタグを全て含む人。 */
    case 'tag_all': {
      const ids = asStringArray(rule.value, 'tag_all')
      const placeholders = ids.map(() => '?').join(', ')
      bindings.push(...ids, ids.length)
      return {
        sql: `(SELECT COUNT(DISTINCT ft.tag_id) FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id IN (${placeholders})) = ?`,
        bindings,
      }
    }

    /* 選択したタグを全て含む人を除外。 */
    case 'tag_not_all': {
      const ids = asStringArray(rule.value, 'tag_not_all')
      const placeholders = ids.map(() => '?').join(', ')
      bindings.push(...ids, ids.length)
      return {
        sql: `(SELECT COUNT(DISTINCT ft.tag_id) FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id IN (${placeholders})) < ?`,
        bindings,
      }
    }

    case 'metadata_equals': {
      const mv = asRecord(rule.value, 'metadata_equals')
      if (typeof mv.key !== 'string' || typeof mv.value !== 'string') {
        throw new Error('metadata_equals rule requires { key: string; value: string }')
      }
      bindings.push(`$.${mv.key}`, mv.value)
      return { sql: `json_extract(f.metadata, ?) = ?`, bindings }
    }

    case 'metadata_not_equals': {
      const mv = asRecord(rule.value, 'metadata_not_equals')
      if (typeof mv.key !== 'string' || typeof mv.value !== 'string') {
        throw new Error('metadata_not_equals rule requires { key: string; value: string }')
      }
      bindings.push(`$.${mv.key}`, `$.${mv.key}`, mv.value)
      return { sql: `(json_extract(f.metadata, ?) IS NULL OR json_extract(f.metadata, ?) != ?)`, bindings }
    }

    case 'ref_code': {
      bindings.push(asString(rule.value, 'ref_code'))
      return { sql: `f.ref_code = ?`, bindings }
    }

    case 'is_following': {
      if (typeof rule.value !== 'boolean') {
        throw new Error('is_following rule requires a boolean value')
      }
      bindings.push(rule.value ? 1 : 0)
      return { sql: `f.is_following = ?`, bindings }
    }

    case 'is_hidden': {
      if (typeof rule.value !== 'boolean') {
        throw new Error('is_hidden rule requires a boolean value')
      }
      bindings.push(rule.value ? 1 : 0)
      return { sql: `f.is_hidden = ?`, bindings }
    }

    /*
     * いまシナリオを購読している人。
     *
     * value が空文字なら「どれか1つでも購読していれば対象」。シナリオIDを
     * 入れると、そのシナリオを購読している人だけになる。
     *
     * 'delivering' も購読中に数える。配信の処理中というだけの状態で、
     * 外すと配信のタイミングによって対象人数が動く。'paused' と
     * 'completed' は購読中ではないので入れない。
     */
    case 'scenario_subscribed': {
      const id = asString(rule.value, 'scenario_subscribed')
      if (id === '') {
        return {
          sql: `EXISTS (SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.status IN ('active','delivering'))`,
          bindings,
        }
      }
      bindings.push(id)
      return {
        sql: `EXISTS (SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.status IN ('active','delivering') AND fs.scenario_id = ?)`,
        bindings,
      }
    }

    /*
     * シナリオの購読状態。scenario_subscribed より細かく指定する。
     *   subscribed     … いま購読中
     *   not_subscribed … いま購読していない（読み終えた人も含む）
     *   completed      … 読み終えた
     *   ever           … 1度でも購読したことがある
     */
    case 'scenario_state': {
      const v = asRecord(rule.value, 'scenario_state')
      const scenarioId = typeof v.scenarioId === 'string' ? v.scenarioId : ''
      const state = typeof v.state === 'string' ? v.state : 'subscribed'
      if (scenarioId === '') {
        throw new Error('scenario_state rule requires a scenarioId')
      }
      const scoped = `SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.scenario_id = ?`
      switch (state) {
        case 'subscribed':
          bindings.push(scenarioId)
          return { sql: `EXISTS (${scoped} AND fs.status IN ('active','delivering'))`, bindings }
        case 'not_subscribed':
          bindings.push(scenarioId)
          return { sql: `NOT EXISTS (${scoped} AND fs.status IN ('active','delivering'))`, bindings }
        case 'completed':
          bindings.push(scenarioId)
          return { sql: `EXISTS (${scoped} AND fs.status = 'completed')`, bindings }
        case 'ever':
          bindings.push(scenarioId)
          return { sql: `EXISTS (${scoped})`, bindings }
        default:
          throw new Error(`Unknown scenario_state: ${state}`)
      }
    }

    /*
     * 名前。どの欄から探すかを選べる。半角スペースで区切ると、いずれかに
     * あてはまる人が対象になる（OR）。
     */
    case 'name': {
      const v = asRecord(rule.value, 'name')
      const text = typeof v.text === 'string' ? v.text.trim() : ''
      if (text === '') {
        throw new Error('name rule requires a non-empty text')
      }
      const rawTargets = Array.isArray(v.targets) ? (v.targets as unknown[]) : []
      const targets = rawTargets.filter(
        (t): t is string => typeof t === 'string' && t in NAME_COLUMNS,
      )
      const columns = (targets.length > 0 ? targets : Object.keys(NAME_COLUMNS)).map(
        (t) => NAME_COLUMNS[t],
      )
      const words = text.split(/[\s　]+/).filter(Boolean)
      const perWord = words.map((word) => {
        const perColumn = columns.map((col) => {
          bindings.push(`%${word}%`)
          return `${col} LIKE ?`
        })
        return `(${perColumn.join(' OR ')})`
      })
      return { sql: `(${perWord.join(' OR ')})`, bindings }
    }

    case 'private_memo': {
      const text = asString(rule.value, 'private_memo')
      if (text === '') throw new Error('private_memo rule requires a non-empty value')
      bindings.push(`%${text}%`)
      return { sql: `f.private_memo LIKE ?`, bindings }
    }

    case 'status_message': {
      const text = asString(rule.value, 'status_message')
      if (text === '') throw new Error('status_message rule requires a non-empty value')
      bindings.push(`%${text}%`)
      return { sql: `f.status_message LIKE ?`, bindings }
    }

    case 'registered_at':
      return buildDateRange('f.created_at', rule.value, 'registered_at')

    /* 対応マーク。複数選んだら「いずれかに一致」。 */
    case 'support_mark': {
      const v = asRecord(rule.value, 'support_mark')
      const ids = asStringArray(v.markIds, 'support_mark')
      const placeholders = ids.map(() => '?').join(', ')
      bindings.push(...ids)
      const inClause = `f.support_mark_id IN (${placeholders})`
      return { sql: v.exclude === true ? `(f.support_mark_id IS NULL OR NOT ${inClause})` : inClause, bindings }
    }

    /*
     * 友だち情報欄。
     *
     * 「登録なし」だけは EXISTS を反転させる必要がある。行そのものが無い人と、
     * 行はあるが空の人の両方を拾わないと、画面の見た目と食い違う。
     */
    case 'friend_field': {
      const v = asRecord(rule.value, 'friend_field')
      const fieldId = typeof v.fieldId === 'string' ? v.fieldId : ''
      if (fieldId === '') throw new Error('friend_field rule requires a fieldId')
      const op = (typeof v.op === 'string' ? v.op : 'contains') as FieldOperator
      const text = typeof v.text === 'string' ? v.text : ''
      if (op === 'not_exists') {
        bindings.push(fieldId)
        return {
          sql: `NOT EXISTS (SELECT 1 FROM friend_field_values ffv WHERE ffv.friend_id = f.id AND ffv.field_id = ? AND ffv.value IS NOT NULL AND ffv.value != '')`,
          bindings,
        }
      }
      const cmp = buildValueComparison('ffv.value', op, text)
      bindings.push(fieldId, ...cmp.bindings)
      return {
        sql: `EXISTS (SELECT 1 FROM friend_field_values ffv WHERE ffv.friend_id = f.id AND ffv.field_id = ? AND ${cmp.sql})`,
        bindings,
      }
    }

    case 'form_answered': {
      const formId = asString(rule.value, 'form_answered')
      if (formId === '') {
        return {
          sql: `EXISTS (SELECT 1 FROM form_submissions fsub WHERE fsub.friend_id = f.id)`,
          bindings,
        }
      }
      bindings.push(formId)
      return {
        sql: `EXISTS (SELECT 1 FROM form_submissions fsub WHERE fsub.friend_id = f.id AND fsub.form_id = ?)`,
        bindings,
      }
    }

    /* 最終反応日。こちらからの送信ではなく、友だちからの反応だけを見る。 */
    case 'last_reaction_at':
      return buildDateRange(
        `(SELECT MAX(ml.created_at) FROM messages_log ml WHERE ml.friend_id = f.id AND ml.direction = 'incoming')`,
        rule.value,
        'last_reaction_at',
      )

    /*
     * 反応状態。
     *
     * postback は source 列で見分ける。webhook 側が postback の incoming に
     * source='postback' を入れているので、それ以外の incoming を「返信」とする。
     */
    case 'reaction_state': {
      const state = asString(rule.value, 'reaction_state') as ReactionState
      if (!REACTION_STATES.includes(state)) {
        throw new Error(`Unknown reaction_state: ${state}`)
      }
      const anyIncoming = `EXISTS (SELECT 1 FROM messages_log ml WHERE ml.friend_id = f.id AND ml.direction = 'incoming')`
      const reply = `EXISTS (SELECT 1 FROM messages_log ml WHERE ml.friend_id = f.id AND ml.direction = 'incoming' AND (ml.source IS NULL OR ml.source != 'postback'))`
      const postback = `EXISTS (SELECT 1 FROM messages_log ml WHERE ml.friend_id = f.id AND ml.direction = 'incoming' AND ml.source = 'postback')`
      switch (state) {
        case 'any':
          return { sql: '1=1', bindings }
        case 'reply_or_postback':
          return { sql: anyIncoming, bindings }
        case 'reply':
          return { sql: reply, bindings }
        case 'postback':
          return { sql: `(${postback} AND NOT ${reply})`, bindings }
        case 'none':
          return { sql: `NOT ${anyIncoming}`, bindings }
      }
      break
    }

    default: {
      const exhaustive: never = rule.type
      throw new Error(`Unknown segment rule type: ${exhaustive}`)
    }
  }
  throw new Error(`Unhandled segment rule: ${String(rule.type)}`)
}

/**
 * 条件を WHERE 句にする。グループがあれば再帰する。
 *
 * 条件が1つも無いときは 1=1 を返す。ここで 1=0 にしてしまうと、
 * 「絞り込みなし＝全員」の意味が反転して誰にも届かなくなる。
 */
export function buildSegmentWhere(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const clauses: string[] = []

  for (const rule of condition.rules ?? []) {
    const built = buildRuleClause(rule)
    clauses.push(built.sql)
    bindings.push(...built.bindings)
  }

  for (const group of condition.groups ?? []) {
    const built = buildSegmentWhere(group)
    // 中身が空のグループは足さない。1=1 を AND でつなぐぶんには無害だが、
    // OR でつなぐと全員に一致してしまう。
    if ((group.rules?.length ?? 0) === 0 && (group.groups?.length ?? 0) === 0) continue
    clauses.push(`(${built.sql})`)
    bindings.push(...built.bindings)
  }

  const separator = condition.operator === 'AND' ? ' AND ' : ' OR '
  return { sql: clauses.length > 0 ? clauses.join(separator) : '1=1', bindings }
}

export function buildSegmentQuery(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const where = buildSegmentWhere(condition)
  return {
    sql: `SELECT f.id, f.line_user_id, f.display_name FROM friends f WHERE ${where.sql} ORDER BY f.created_at ASC, f.id ASC`,
    bindings: where.bindings,
  }
}

/**
 * 1人が条件にあてはまるかを見る。
 *
 * 配信の直前と、アクションの実行前に呼ぶ。一覧用の SQL を組み立て直さずに
 * 同じ WHERE を使い回すので、「一覧に出た人」と「実際に届く人」がずれない。
 */
export async function matchesCondition(
  db: D1Database,
  friendId: string,
  condition: SegmentCondition | null,
): Promise<boolean> {
  if (!condition) return true
  const hasAnything = (condition.rules?.length ?? 0) > 0 || (condition.groups?.length ?? 0) > 0
  if (!hasAnything) return true

  const where = buildSegmentWhere(condition)
  const row = await db
    .prepare(`SELECT 1 AS ok FROM friends f WHERE f.id = ? AND (${where.sql}) LIMIT 1`)
    .bind(friendId, ...where.bindings)
    .first<{ ok: number }>()
  return !!row
}

/**
 * 保存されている JSON を条件として読む。
 *
 * 壊れた JSON は「条件なし」ではなく null を返して呼び出し側に判断させる。
 * 壊れているのに全員に配ってしまうのがいちばん困る。
 */
export function parseCondition(raw: string | null | undefined): SegmentCondition | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SegmentCondition
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.operator !== 'AND' && parsed.operator !== 'OR') return null
    if (!Array.isArray(parsed.rules)) return null
    return parsed
  } catch {
    return null
  }
}
