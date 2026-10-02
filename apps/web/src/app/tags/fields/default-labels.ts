import type { FriendField } from '@line-crm/shared'

/*
 * R182: 保存済みの既定値はID（複数選択はIDの配列のJSON）で入っている。
 * 画面は選択肢名で持つため、読み込み時と同じ戻し方で「保存済みの
 * 選択肢名」を作り、未保存の判定に使う。IDのまま比べると、単一選択は
 * 開いた瞬間に未保存扱いになり、複数選択は変えても未保存にならない。
 */
export function storedDefaultLabels(field: FriendField): { single: string; multi: string[] } {
  const stored = field.defaultValue ?? ''
  const labels = field.options ?? []
  const definitions = field.optionDefinitions ?? null
  const toLabel = (entry: string): string | null =>
    definitions?.find((item) => item.id === entry)?.label
    ?? (labels.includes(entry) ? entry : null)
  if (field.type === 'multi_select') {
    let entries: string[] = []
    try {
      const parsed: unknown = JSON.parse(stored)
      if (Array.isArray(parsed)) entries = parsed.map(String)
    } catch { entries = [] }
    return { single: '', multi: entries.map(toLabel).filter((item): item is string => item !== null) }
  }
  if (field.type === 'select' && stored) return { single: toLabel(stored) ?? '', multi: [] }
  return { single: stored, multi: [] }
}

export function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((item, index) => item === sortedB[index])
}
