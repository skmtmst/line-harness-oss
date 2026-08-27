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

export function describeSavedCondition(condition: SavedSearchCondition, tags: Tag[] = []): string {
  const raw = typeof condition.value === 'string' ? condition.value : ''
  const value = condition.kind === 'tag'
    ? tags.find((tag) => tag.id === raw)?.name ?? raw
    : raw
  if (condition.kind === 'tag') return `タグ ${condition.op === 'excludes' ? 'を含まない' : 'を含む'}「${value || '未指定'}」`
  if (condition.kind === 'name') return `名前に「${value || '未指定'}」を含む`
  if (condition.kind === 'field') return `${condition.key || '項目未指定'} ${condition.op === 'ne' ? 'が次と異なる' : 'が次と同じ'}「${value || '未指定'}」`
  if (condition.kind === 'status_message') return `ステータスメッセージに「${value || '未指定'}」を含む`
  if (condition.kind === 'mark') return `対応マークが「${value || '未指定'}」`
  if (condition.kind === 'scenario') return `シナリオが「${value || '未指定'}」`
  if (condition.kind === 'chat_status') return `対応状態が「${value || '未指定'}」`
  if (condition.kind === 'following') return condition.value === true ? '友だち中' : 'ブロック済み'
  if (condition.kind === 'created_at') return '友だち追加日を指定'
  if (condition.kind === 'form') return '回答フォーム（未接続）'
  if (condition.kind === 'purchase') return '購入履歴（未接続）'
  return `${condition.kind} ${condition.op} ${value}`
}

export function savedSearchSummary(conditions: SavedSearchConditions, tags: Tag[] = []): string[] {
  return [
    ...(conditions.all ?? []).map((condition) => `AND: ${describeSavedCondition(condition, tags)}`),
    ...(conditions.any ?? []).map((condition) => `OR: ${describeSavedCondition(condition, tags)}`),
  ]
}
