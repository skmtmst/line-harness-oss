/*
 * 友だち一覧の絞り込み条件を、一斉配信の対象条件（SegmentCondition）へ写す。
 *
 * IDEA-03「検索から配信等へ進むときは対象条件を引き継ぐ」。
 * 配信側は保存した条件を送るたびに最新の友だちへ再評価するので、
 * 「一覧に出ていたIDの集合」ではなく「条件そのもの」を渡す
 * （画面に出た一部だけを対象にしない、という決めごと）。
 *
 * 写せない条件があるときは null を返し、呼び出し側はリンクを出さない。
 * 写せない条件を黙って落とすと対象が広がって誤配信になるため、
 * 部分的な引き継ぎはしない。
 */
import type { SavedSearchCondition, SavedSearchConditions } from '@line-crm/shared'

import type { AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import type { FriendListParams } from './api'
import type { SegmentCondition, SegmentRule } from './segment-condition'

/** 一覧の絞り込みのうち、配信の対象条件へ写せるかの判定結果。 */
export type BroadcastHandoff =
  /** 絞り込みが無い。リンクは出さない。 */
  | { kind: 'none' }
  /** 写せない条件を含む。誤配信を防ぐためリンクを出さない。 */
  | { kind: 'blocked' }
  | { kind: 'ready'; condition: SegmentCondition }

const CHAT_STATUS_VALUES = ['unread', 'in_progress', 'on_hold', 'resolved'] as const

/*
 * 一覧の「名前で検索」(f.display_name LIKE %語%) を name ルールへ。
 * name ルールは空白区切りの OR ・ワイルドカード非エスケープなので、
 * 完全一致で写せるのは1語・記号なしの検索だけ。写せない形は null。
 */
function nameRule(text: string): SegmentRule | null {
  const trimmed = text.trim()
  if (!trimmed || /[\s　]/.test(trimmed) || /[%_\\]/.test(trimmed)) return null
  return { type: 'name', value: { text: trimmed, targets: ['display'] } }
}

function dateRangeRule(from: string | undefined, to: string | undefined): SegmentRule | null {
  if (!from && !to) return null
  return { type: 'registered_at', value: { from: from || undefined, to: to || undefined } }
}

/** 保存条件1件 → 配信ルール1件。写せない形は null。 */
function savedConditionToRule(condition: SavedSearchCondition): SegmentRule | null {
  const text = typeof condition.value === 'string' && condition.value ? condition.value : null
  switch (condition.kind) {
    case 'name':
      return condition.op === 'contains' && text ? nameRule(text) : null
    case 'tag':
      if (!text) return null
      if (['includes', 'has', 'eq'].includes(condition.op)) {
        return { type: 'tag_exists', value: text }
      }
      if (['excludes', 'not_has', 'ne'].includes(condition.op)) {
        return { type: 'tag_not_exists', value: text }
      }
      return null
    case 'field': {
      const key = typeof condition.key === 'string' && condition.key ? condition.key : null
      if (!key || !text) return null
      if (condition.op === 'eq' || condition.op === 'equals') {
        return { type: 'metadata_equals', value: { key, value: text } }
      }
      if (condition.op === 'ne' || condition.op === 'not_equals') {
        return { type: 'metadata_not_equals', value: { key, value: text } }
      }
      return null
    }
    case 'status_message':
      return condition.op === 'contains' && text ? { type: 'status_message', value: text } : null
    case 'mark':
      return condition.op === 'eq' && text ? { type: 'support_mark', value: { markIds: [text] } } : null
    case 'assignee':
      return condition.op === 'eq' && text ? { type: 'operator_id', value: text } : null
    case 'chat_status':
      return condition.op === 'eq' && text && (CHAT_STATUS_VALUES as readonly string[]).includes(text)
        ? { type: 'chat_status', value: text }
        : null
    case 'following':
      return condition.op === 'eq' && typeof condition.value === 'boolean'
        ? { type: 'is_following', value: condition.value }
        : null
    case 'scenario':
      return condition.op === 'eq' && text
        ? { type: 'scenario_state', value: { scenarioId: text, state: 'subscribed' } }
        : null
    case 'form': {
      if (!['exists', 'has', 'eq'].includes(condition.op)) return null
      const formId =
        (typeof condition.formId === 'string' && condition.formId ? condition.formId : null) ?? text ?? ''
      return { type: 'form_answered', value: formId }
    }
    case 'created_at': {
      if (condition.op === 'between' && condition.value && typeof condition.value === 'object') {
        const range = condition.value as { from?: unknown; to?: unknown }
        return dateRangeRule(
          typeof range.from === 'string' ? range.from : undefined,
          typeof range.to === 'string' ? range.to : undefined,
        )
      }
      if (condition.op === 'after') return dateRangeRule(text ?? undefined, undefined)
      if (condition.op === 'before') return dateRangeRule(undefined, text ?? undefined)
      return null
    }
    /*
     * 写せないもの: 最終反応日(台帳の取り方が違う)・予約系の存在確認・
     * リマインダ・個別メモ・共通イベント・購入履歴。
     */
    default:
      return null
  }
}

/** SavedSearchConditions → SegmentCondition。1件でも写せなければ null。 */
function savedConditionsToSegment(conditions: SavedSearchConditions): SegmentCondition | null {
  const rules: SegmentRule[] = []
  for (const condition of conditions.all ?? []) {
    const rule = savedConditionToRule(condition)
    if (!rule) return null
    rules.push(rule)
  }
  const anyRules: SegmentRule[] = []
  for (const condition of conditions.any ?? []) {
    const rule = savedConditionToRule(condition)
    if (!rule) return null
    anyRules.push(rule)
  }
  if (conditions.visibility === 'visible_only') rules.push({ type: 'is_hidden', value: false })
  if (conditions.visibility === 'hidden_only') rules.push({ type: 'is_hidden', value: true })
  if (rules.length === 0 && anyRules.length === 0) return null
  return {
    operator: 'AND',
    rules,
    ...(anyRules.length ? { groups: [{ operator: 'OR' as const, rules: anyRules }] } : {}),
  }
}

/** 詳細条件の平たい引数（conditions が無い適用）→ ルール列。 */
function flatParamsToRules(params: FriendListParams): SegmentRule[] | null {
  const rules: SegmentRule[] = []
  if (params.savedSearchId) return null
  if (params.search) {
    const rule = nameRule(params.search)
    if (!rule) return null
    rules.push(rule)
  }
  if (params.tagIds?.length) rules.push({ type: 'tag_all', value: [...params.tagIds] })
  for (const id of params.excludeTagIds ?? []) rules.push({ type: 'tag_not_exists', value: id })
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    rules.push({ type: 'metadata_equals', value: { key, value } })
  }
  for (const [key, value] of Object.entries(params.metadataNot ?? {})) {
    rules.push({ type: 'metadata_not_equals', value: { key, value } })
  }
  if (params.statusMessage) rules.push({ type: 'status_message', value: params.statusMessage })
  if (params.createdFrom || params.createdTo) {
    const rule = dateRangeRule(params.createdFrom, params.createdTo)
    if (rule) rules.push(rule)
  }
  if (params.chatStatus) rules.push({ type: 'chat_status', value: params.chatStatus })
  if (params.visibility === 'following') rules.push({ type: 'is_following', value: true })
  if (params.visibility === 'blocked') rules.push({ type: 'is_following', value: false })
  return rules
}

/**
 * 一覧画面の絞り込み状態すべてを受け取り、配信へ引き継ぐ条件を組み立てる。
 * 並び順・表示件数・ページは対象を決めないので含めない。
 */
export function buildBroadcastHandoff(input: {
  searchSubmitted: string
  selectedTagId: string
  responseFilter: 'all' | 'unhandled'
  operatorId: string
  scenarioId: string
  attentionOnly: boolean
  scoreMin?: number
  scoreMax?: number
  audienceId: string
  advanced: AdvancedSearchResult | null
}): BroadcastHandoff {
  const rules: SegmentRule[] = []
  let groups: SegmentCondition[] | undefined

  // ── 上段の絞り込み（詳細条件と別系統で、そのまま AND で効く） ──────────
  if (input.searchSubmitted) {
    const rule = nameRule(input.searchSubmitted)
    if (!rule) return { kind: 'blocked' }
    rules.push(rule)
  }
  if (input.selectedTagId) rules.push({ type: 'tag_exists', value: input.selectedTagId })
  if (input.responseFilter === 'unhandled') rules.push({ type: 'chat_status', value: 'unread' })
  if (input.operatorId) rules.push({ type: 'operator_id', value: input.operatorId })
  if (input.scenarioId) {
    rules.push({ type: 'scenario_state', value: { scenarioId: input.scenarioId, state: 'subscribed' } })
  }
  if (input.attentionOnly) {
    rules.push({ type: 'metadata_equals', value: { key: '__attention', value: '1' } })
  }
  if (input.scoreMin !== undefined || input.scoreMax !== undefined) {
    rules.push({ type: 'score_range', value: { min: input.scoreMin, max: input.scoreMax } })
  }
  if (input.audienceId) {
    rules.push({ type: 'analytics_audience', value: { audienceId: input.audienceId } })
  }

  // ── 詳細条件。実絞り込みの正本は conditions（search_v1）。 ──────────
  const params = input.advanced?.params
  if (params) {
    if (params.savedSearchId) {
      // 保存検索の中身はサーバー保管。画面には写せないので引き継がない。
      return { kind: 'blocked' }
    }
    if (params.conditions) {
      const segment = savedConditionsToSegment(params.conditions)
      if (!segment) return { kind: 'blocked' }
      rules.push(...segment.rules)
      if (segment.groups?.length) groups = segment.groups
    } else {
      const flat = flatParamsToRules(params)
      if (flat === null) return { kind: 'blocked' }
      rules.push(...flat)
    }
  }

  if (rules.length === 0 && !groups?.length) return { kind: 'none' }
  return {
    kind: 'ready',
    condition: { operator: 'AND', rules, ...(groups ? { groups } : {}) },
  }
}
