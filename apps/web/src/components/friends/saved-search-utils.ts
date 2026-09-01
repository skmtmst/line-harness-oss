import type {
  SavedSearchCondition,
  SavedSearchConditions,
  Tag,
} from '@line-crm/shared'
import type { FriendListParams } from '@/lib/api'

/** 友だち一覧の詳細条件を、既存 saved_searches のAND群へ保存する。 */
export function friendParamsToSavedConditions(
  params: FriendListParams,
): SavedSearchConditions {
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

export type SavedSearchConditionLabels = {
  marks?: Readonly<Record<string, string>>
  scenarios?: Readonly<Record<string, string>>
  fields?: Readonly<Record<string, string>>
}

const CHAT_STATUS_LABELS: Readonly<Record<string, string>> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '対応済み',
}

/** 保存値のIDや演算子を画面へ露出させず、運用者が読める条件にする。 */
export function describeSavedCondition(
  condition: SavedSearchCondition,
  tags: Tag[] = [],
  labels: SavedSearchConditionLabels = {},
): string {
  const raw = typeof condition.value === 'string' ? condition.value : ''
  const value = condition.kind === 'tag'
    ? tags.find((tag) => tag.id === raw)?.name ?? (raw ? '選択済みのタグ' : '')
    : raw
  if (condition.kind === 'tag') return `タグ ${condition.op === 'excludes' ? 'を含まない' : 'を含む'}「${value || '未指定'}」`
  if (condition.kind === 'name') return `名前に「${value || '未指定'}」を含む`
  if (condition.kind === 'field') {
    const fieldName = condition.key
      ? labels.fields?.[condition.key] ?? '選択済みの友だち情報'
      : '項目未指定'
    return `${fieldName} ${condition.op === 'ne' ? 'が次と異なる' : 'が次と同じ'}「${value || '未指定'}」`
  }
  if (condition.kind === 'status_message') return `ステータスメッセージに「${value || '未指定'}」を含む`
  if (condition.kind === 'mark') return `対応マークが「${labels.marks?.[raw] ?? (raw ? '選択済みの対応マーク' : '未指定')}」`
  if (condition.kind === 'scenario') return `シナリオが「${labels.scenarios?.[raw] ?? (raw ? '選択済みのシナリオ' : '未指定')}」`
  if (condition.kind === 'chat_status') return `対応状態が「${CHAT_STATUS_LABELS[raw] ?? (raw ? '選択済みの状態' : '未指定')}」`
  if (condition.kind === 'following') return condition.value === true ? '友だち中' : 'ブロック済み'
  if (condition.kind === 'created_at') {
    const range = condition.value && typeof condition.value === 'object'
      ? condition.value as { from?: unknown; to?: unknown }
      : {}
    const from = typeof range.from === 'string' ? range.from : ''
    const to = typeof range.to === 'string' ? range.to : ''
    if (from && to) return `友だち追加日が ${from}〜${to}`
    if (from) return `友だち追加日が ${from}以降`
    if (to) return `友だち追加日が ${to}以前`
    return '友だち追加日を指定'
  }
  if (condition.kind === 'form') return '回答フォーム（未接続）'
  if (condition.kind === 'purchase') return '購入履歴（未接続）'
  return '条件を確認できません'
}

export function savedSearchSummary(conditions: SavedSearchConditions, tags: Tag[] = []): string[] {
  return [
    ...(conditions.all ?? []).map((condition) => `AND: ${describeSavedCondition(condition, tags)}`),
    ...(conditions.any ?? []).map((condition) => `OR: ${describeSavedCondition(condition, tags)}`),
  ]
}
