import type { SavedSearchCondition, SavedSearchConditions } from '@line-crm/shared';
import type { FriendListParams } from '@/lib/api';
export { type SavedSearchConditionLabels, describeSavedCondition, savedSearchSummary } from "./saved-search-utils-gap-parts"
/** 友だち一覧の詳細条件を、既存 saved_searches のAND群へ保存する。 */
export function friendParamsToSavedConditions(
  params: FriendListParams,
): SavedSearchConditions {
  if (params.conditions) return params.conditions
  const all: SavedSearchCondition[] = []
  if (params.search) all.push({ kind: 'name', op: 'contains', value: params.search })
  for (const id of params.tagIds ?? []) all.push({ kind: 'tag', op: 'includes', value: id })
  for (const id of params.excludeTagIds ?? []) all.push({ kind: 'tag', op: 'excludes', value: id })
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    all.push({ kind: 'field', key, op: 'eq', value })
  }
  for (const [key, value] of Object.entries(params.metadataNot ?? {})) {
    all.push({ kind: 'field', key, op: 'ne', value })
  }
  if (params.statusMessage) {
    all.push({ kind: 'status_message', op: 'contains', value: params.statusMessage })
  }
  if (params.createdFrom || params.createdTo) {
    all.push({
      kind: 'created_at',
      op: 'between',
      value: { from: params.createdFrom || undefined, to: params.createdTo || undefined },
    })
  }
  if (params.chatStatus) all.push({ kind: 'chat_status', op: 'eq', value: params.chatStatus })
  if (params.visibility) {
    all.push({ kind: 'following', op: 'eq', value: params.visibility === 'following' })
  }
  return {
    all,
    any: [],
    visibility: 'visible_only',
    list: {
      sort: params.sort ?? 'recent',
      limit: ([10, 20, 30, 40, 50].includes(Number(params.limit)) ? Number(params.limit) : 20) as 10 | 20 | 30 | 40 | 50,
    },
  }
}

export function savedSearchParams(id: string, conditions: SavedSearchConditions): FriendListParams {
  return {
    savedSearchId: id,
    sort: conditions.list?.sort ?? 'recent',
    limit: conditions.list?.limit ?? 20,
  }
}

/* ── 詳細条件の編集状態 ────────────────────────────────────────
 *
 * FRIEND-01/02/32: 画面の条件と送信する条件を1つの状態で持つ。
 * ・同じ項目の条件を複数並べても、配列のまま all へ残す（上書きしない）。
 * ・対象（表示中/非表示/ブロック/すべて）は4値の明示的な選択肢。
 *   `?visibility=` の is_following と `conditions.visibility` の
 *   is_hidden は別の軸なので、空文字で両方を表す二重管理はやめる。
 * ・保存済み条件のうち編集画面で組み直せない種類は extraAll へ保持し、
 *   開く/閉じる/再適用で黙って落とさない（FRIEND-32）。
 */

/** 詳細条件の1ブロック。設計の「条件」1つぶん。 */
export type FriendSearchBlock =
  | { kind: 'name'; keyword: string }
  | { kind: 'tag'; include: string[]; exclude: string[] }
  | { kind: 'field'; key: string; op: 'eq' | 'ne'; value: string }
  | { kind: 'status_message'; keyword: string }
  | { kind: 'created_at'; from: string; to: string }
  | { kind: 'chat_status'; value: 'unread' | 'in_progress' | 'on_hold' | 'resolved' }
  /* 来店・購入・会員ランク：回数・金額は下限と上限、日は期間、ランクは段の ID。 */
  | { kind: 'visit_count'; min: string; max: string }
  | { kind: 'purchase_amount'; min: string; max: string }
  | { kind: 'last_activity_at'; from: string; to: string }
  | { kind: 'member_tier'; tierId: string }

/** 「表示する友だち」の選択肢。空文字を使い回す二重管理はしない。 */
export type FriendVisibilityChoice = 'visible' | 'hidden' | 'blocked' | 'all'

export interface FriendSearchEditorState {
  blocks: FriendSearchBlock[]
  any: SavedSearchCondition[]
  /** 編集画面で組み直せない保存済みAND条件。外すまで適用・保存へ残す。 */
  extraAll: SavedSearchCondition[]
  visibility: FriendVisibilityChoice
}

const CHAT_STATUS_VALUES = ['unread', 'in_progress', 'on_hold', 'resolved'] as const

export function blockToConditions(block: FriendSearchBlock): SavedSearchCondition[] {
  switch (block.kind) {
    case 'name':
      return block.keyword.trim()
        ? [{ kind: 'name', op: 'contains', value: block.keyword.trim() }]
        : []
    case 'tag':
      return [
        ...block.include.map((id): SavedSearchCondition => ({ kind: 'tag', op: 'includes', value: id })),
        ...block.exclude.map((id): SavedSearchCondition => ({ kind: 'tag', op: 'excludes', value: id })),
      ]
    case 'field':
      return block.key.trim() && block.value.trim()
        ? [{ kind: 'field', key: block.key.trim(), op: block.op, value: block.value.trim() }]
        : []
    case 'status_message':
      return block.keyword.trim()
        ? [{ kind: 'status_message', op: 'contains', value: block.keyword.trim() }]
        : []
    case 'created_at': {
      if (!block.from && !block.to) return []
      return [{
        kind: 'created_at',
        op: 'between',
        value: { from: block.from || undefined, to: block.to || undefined },
      }]
    }
    case 'chat_status':
      return [{ kind: 'chat_status', op: 'eq', value: block.value }]
    case 'visit_count':
    case 'purchase_amount': {
      const min = block.min.trim() === '' ? undefined : Number(block.min)
      const max = block.max.trim() === '' ? undefined : Number(block.max)
      if (min === undefined && max === undefined) return []
      return [{ kind: block.kind, op: 'between', value: { min, max } }]
    }
    case 'last_activity_at':
      return block.from || block.to ? [{ kind: 'last_activity_at', op: 'between', value: { from: block.from || undefined, to: block.to || undefined } }] : []
    case 'member_tier':
      return block.tierId ? [{ kind: 'member_tier', op: 'eq', value: block.tierId }] : []
  }
}

/** 編集状態をサーバーが受け取る条件へ変換する。全ブロックを残す。 */
export function editorStateToConditions(
  state: FriendSearchEditorState,
  list: { sort: 'recent' | 'oldest'; limit: number },
): SavedSearchConditions {
  const all: SavedSearchCondition[] = []
  for (const block of state.blocks) all.push(...blockToConditions(block))
  all.push(...state.extraAll)
  if (state.visibility === 'visible') {
    all.push({ kind: 'following', op: 'eq', value: true })
  } else if (state.visibility === 'blocked') {
    all.push({ kind: 'following', op: 'eq', value: false })
  }
  return {
    all,
    any: state.any,
    visibility:
      state.visibility === 'visible'
        ? 'visible_only'
        : state.visibility === 'hidden'
          ? 'hidden_only'
          : 'all',
    list: {
      sort: list.sort,
      limit: ([10, 20, 30, 40, 50].includes(list.limit) ? list.limit : 20) as 10 | 20 | 30 | 40 | 50,
    },
  }
}

/**
 * 条件に実際の絞り込みが入っているか。
 * 「すべて」（visibility='all'）で条件も無いときは送っても
 * 受け口で弾かれるだけなので、そもそも送らない判断に使う（FRIEND-01）。
 * 「非表示のみ」など visibility だけの条件は有効な絞り込みとして true。
 */
export function hasSavedSearchFilter(conditions: SavedSearchConditions): boolean {
  return (conditions.all?.length ?? 0) > 0
    || (conditions.any?.length ?? 0) > 0
    || (conditions.visibility !== undefined && conditions.visibility !== 'all')
}

/** 保存済み条件を編集画面の状態へ戻す。戻せない条件は extraAll へ残す。 */
export function conditionsToEditorState(conditions: SavedSearchConditions): FriendSearchEditorState {
  const blocks: FriendSearchBlock[] = []
  const extraAll: SavedSearchCondition[] = []
  // conditions.visibility は is_hidden 軸。following 条件（is_following 軸）
  // と組み合わせて4選択肢へ畳む。畳めない組み合わせは extraAll へ残す。
  let visibility: FriendVisibilityChoice =
    conditions.visibility === 'visible_only'
      ? 'visible'
      : conditions.visibility === 'hidden_only'
        ? 'hidden'
        : 'all'

  for (const condition of conditions.all ?? []) {
    if (condition.kind === 'name' && condition.op === 'contains' && typeof condition.value === 'string') {
      blocks.push({ kind: 'name', keyword: condition.value })
      continue
    }
    if (condition.kind === 'tag' && ['includes', 'excludes', 'has', 'eq', 'not_has', 'ne'].includes(condition.op)
        && typeof condition.value === 'string' && condition.value) {
      const include = ['includes', 'has', 'eq'].includes(condition.op)
      // 同じ種類のタグ条件が複数あっても1ブロックへ畳む（ANDとして同じ意味）。
      const block = blocks.find((b): b is Extract<FriendSearchBlock, { kind: 'tag' }> => b.kind === 'tag')
        ?? { kind: 'tag' as const, include: [] as string[], exclude: [] as string[] }
      if (!blocks.includes(block)) blocks.push(block)
      const target = include ? block.include : block.exclude
      if (!target.includes(condition.value)) target.push(condition.value)
      continue
    }
    if (condition.kind === 'field' && ['eq', 'ne'].includes(condition.op)
        && typeof condition.key === 'string' && typeof condition.value === 'string') {
      blocks.push({ kind: 'field', key: condition.key, op: condition.op as 'eq' | 'ne', value: condition.value })
      continue
    }
    if (condition.kind === 'status_message' && ['contains', 'eq'].includes(condition.op)
        && typeof condition.value === 'string') {
      blocks.push({ kind: 'status_message', keyword: condition.value })
      continue
    }
    if (condition.kind === 'created_at') {
      if (condition.op === 'between' && condition.value && typeof condition.value === 'object') {
        const range = condition.value as { from?: unknown; to?: unknown }
        blocks.push({
          kind: 'created_at',
          from: typeof range.from === 'string' ? range.from : '',
          to: typeof range.to === 'string' ? range.to : '',
        })
        continue
      }
      if (['after', 'before'].includes(condition.op) && typeof condition.value === 'string') {
        blocks.push({
          kind: 'created_at',
          from: condition.op === 'after' ? condition.value : '',
          to: condition.op === 'before' ? condition.value : '',
        })
        continue
      }
    }
    if (condition.kind === 'chat_status' && condition.op === 'eq'
        && (CHAT_STATUS_VALUES as readonly string[]).includes(String(condition.value))) {
      blocks.push({
        kind: 'chat_status',
        value: condition.value as 'unread' | 'in_progress' | 'on_hold' | 'resolved',
      })
      continue
    }
    if ((condition.kind === 'visit_count' || condition.kind === 'purchase_amount') && condition.op === 'between' && condition.value && typeof condition.value === 'object') {
      const range = condition.value as { min?: unknown; max?: unknown }
      blocks.push({ kind: condition.kind, min: typeof range.min === 'number' ? String(range.min) : '', max: typeof range.max === 'number' ? String(range.max) : '' })
      continue
    }
    if (condition.kind === 'last_activity_at' && condition.op === 'between' && condition.value && typeof condition.value === 'object') {
      const range = condition.value as { from?: unknown; to?: unknown }
      blocks.push({ kind: 'last_activity_at', from: typeof range.from === 'string' ? range.from : '', to: typeof range.to === 'string' ? range.to : '' })
      continue
    }
    if (condition.kind === 'member_tier' && condition.op === 'eq' && typeof condition.value === 'string') {
      blocks.push({ kind: 'member_tier', tierId: condition.value })
      continue
    }
    if (condition.kind === 'following' && condition.op === 'eq' && typeof condition.value === 'boolean') {
      if (condition.value === true && visibility === 'visible') continue
      if (condition.value === false && visibility === 'all') {
        visibility = 'blocked'
        continue
      }
      // 画面の4選択肢で表せない組み合わせ（例: 非表示+友だち中）は
      // 黙って捨てず、そのまま残す。
    }
    extraAll.push(condition)
  }

  return { blocks, any: conditions.any ?? [], extraAll, visibility }
}

/** 保存検索の対象範囲を1行で説明する（4条件目以降と一緒に隠れないよう別行で出す）。 */
export function describeSavedVisibility(conditions: SavedSearchConditions): string {
  const hidden =
    conditions.visibility === 'visible_only'
      ? 'visible'
      : conditions.visibility === 'hidden_only'
        ? 'hidden'
        : 'all'
  const following = (conditions.all ?? []).find(
    (condition) => condition.kind === 'following' && condition.op === 'eq' && typeof condition.value === 'boolean',
  )
  if (following?.value === false) return 'ブロックした人'
  if (hidden === 'hidden') return '非表示のみ'
  if (hidden === 'visible') return '表示中のみ'
  return 'すべて'
}
