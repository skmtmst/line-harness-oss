import type { CommonVar } from '@line-crm/shared'
import { csvCell } from '@/lib/presentation'

export type CommonVarFilter = 'all' | 'empty' | 'scheduled' | 'unused'
export type CommonVarOrder = 'usage_desc' | 'updated_desc' | 'name_asc'

export function filterAndSortCommonVars(
  items: CommonVar[],
  input: { query: string; folderId: string; ungroupedValue: string; filter: CommonVarFilter; order: CommonVarOrder },
): CommonVar[] {
  const needle = input.query.trim().toLocaleLowerCase('ja-JP')
  return items
    .filter((item) => {
      if (input.folderId === input.ungroupedValue && item.folderId !== null) return false
      if (input.folderId && input.folderId !== input.ungroupedValue && item.folderId !== input.folderId) return false
      if (input.filter === 'empty' && item.value !== '') return false
      if (input.filter === 'scheduled' && !item.nextSchedule) return false
      if (input.filter === 'unused' && item.usageCount !== 0) return false
      if (!needle) return true
      return [item.name, item.varKey, item.value]
        .some((value) => value.toLocaleLowerCase('ja-JP').includes(needle))
    })
    .toSorted((left, right) => {
      if (input.order === 'name_asc') return left.name.localeCompare(right.name, 'ja-JP')
      if (input.order === 'updated_desc') return right.updatedAt.localeCompare(left.updatedAt)
      const leftUsage = left.usageCount ?? -1
      const rightUsage = right.usageCount ?? -1
      return rightUsage - leftUsage || left.name.localeCompare(right.name, 'ja-JP')
    })
}

export function commonVarsCsv(items: CommonVar[]): string {
  const rows = items.map((item) => [
    item.name,
    `{${item.name}}`,
    item.value,
    item.usageCount ?? '未取得',
    item.updatedAt,
    item.nextSchedule?.effectiveFrom ?? '',
    item.nextSchedule?.value ?? '',
  ])
  return [
    ['共通情報', '差し込みキー', '中身', '使われている場所', '更新', '次の変更日時', '次の中身'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
