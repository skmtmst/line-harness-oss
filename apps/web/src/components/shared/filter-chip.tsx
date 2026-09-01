import { Check, Circle } from 'lucide-react'
import type { ReactNode } from 'react'
import './filter-chip.css'

/**
 * 一覧をその場で絞り込む丸い選択札。
 *
 * 状態を表示するだけの Chip と違い、これは押して条件を切り替える操作に使う。
 */
export default function FilterChip({
  selected,
  onChange,
  children,
}: {
  selected: boolean
  onChange: (selected: boolean) => void
  children: ReactNode
}) {
  const Icon = selected ? Check : Circle
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onChange(!selected)}
      className="v6-filter-chip"
    >
      <Icon aria-hidden="true" className="v6-filter-chip__icon" />
      {children}
    </button>
  )
}
