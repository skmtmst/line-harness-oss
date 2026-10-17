'use client'
import SegmentedControl from '@/components/shared/segmented';
import { type LedgerView } from './format';



export const VIEWS: Array<{ key: LedgerView; label: string }> = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '今週' },
  { key: 'month', label: '今月' },
  { key: 'list', label: '一覧' },
]


/** 頭の見方の切り替え（今日 8・今週 31・今月 112・一覧）。 */
export function ViewSwitch({ view, counts, onChange }: {
  view: LedgerView
  counts: Record<'today' | 'week' | 'month', number> | null
  onChange: (view: LedgerView) => void
}) {
  return (
    <SegmentedControl aria-label="見方の切り替え" size="panel" value={view} onChange={onChange}
      options={VIEWS.map((item) => ({ value: item.key, label: `${item.label}${item.key !== 'list' && counts ? ` ${counts[item.key]}` : ''}` }))} />
  )
}
