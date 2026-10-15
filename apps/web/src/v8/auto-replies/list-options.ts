export type SortKey = 'hits' | 'priority' | 'name' | 'created'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: '評価順' },
  { value: 'hits', label: 'ヒットが多い順' },
  { value: 'name', label: '名前順' },
  { value: 'created', label: '作った順' },
]
