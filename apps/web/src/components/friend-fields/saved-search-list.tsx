import type { SavedSearchCondition, Tag } from '@line-crm/shared'
import { describeSavedCondition, type SavedSearchConditionLabels } from '@/components/friends/saved-search-utils'

export function isSavedSearchCondition(item: unknown): item is SavedSearchCondition {
  if (!item || typeof item !== 'object') return false
  const value = item as Partial<SavedSearchCondition>
  return typeof value.kind === 'string' && typeof value.op === 'string'
}

/** 保存した条件の中身。all（かつ）と any（または）に分けて返す。 */
export function splitConditions(
  conditions: unknown,
  tags: Tag[],
  labels: SavedSearchConditionLabels,
): { all: string[]; any: string[]; note: string | null } {
  const c = conditions as { all?: unknown[]; any?: unknown[]; visibility?: string } | null
  if (!c) return { all: [], any: [], note: null }
  const note =
    c.visibility === 'hidden_only'
      ? '非表示の人のみ'
      : c.visibility === 'all'
        ? '表示状態を問わない'
        : null
  return {
    all: (c.all ?? []).map((item) => isSavedSearchCondition(item) ? describeSavedCondition(item, tags, labels) : '条件を確認できません'),
    any: (c.any ?? []).map((item) => isSavedSearchCondition(item) ? describeSavedCondition(item, tags, labels) : '条件を確認できません'),
    note,
  }
}

export const USAGE_KIND_LABELS = {
  broadcast: '一斉配信',
  automation: 'オートメーション',
  scenario: 'シナリオ',
  other: 'そのほか',
} as const
