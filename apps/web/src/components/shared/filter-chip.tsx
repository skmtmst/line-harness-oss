import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import './filter-chip.css'

/**
 * 一覧の絞り込み札（★V7・全画面で1つだけ使う形）。
 *
 * 丸い札・高さ32・選んだら濃い緑の地に白文字＋✓（#669: 選んだ状態は
 * 「有効状態」なのでアクセントを使う）。件数は文字の後ろに小さく出す。
 * 選んでいないときは印を出さない（○や星などの飾りを付けない）。
 *
 * 状態を表示するだけの Chip と違い、これは押して条件を切り替える操作に使う。
 * 一覧の表示切り替えタブ・受信箱の状態切り替えは別部品のまま（m13i の対象外）。
 */
export default function FilterChip({
  selected,
  onChange,
  count,
  disabled,
  title,
  children,
}: {
  selected: boolean
  onChange: (selected: boolean) => void
  /** 文字の後ろに小さく出す件数。取れていないときは出さない（「—」は置かない）。 */
  count?: number | string
  disabled?: boolean
  /** 選ぶ前に意味を確かめる短い説明（保存検索の条件など）。 */
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!selected)}
      className="v6-filter-chip"
    >
      {selected ? <Check aria-hidden="true" className="v6-filter-chip__icon" /> : null}
      {children}
      {count === undefined || count === '' ? null : (
        <>
          {' '}
          <span className="v6-filter-chip__count">{count}</span>
        </>
      )}
    </button>
  )
}
