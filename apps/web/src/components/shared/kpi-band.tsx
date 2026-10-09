import type { HTMLAttributes, ReactNode } from 'react'
import kpiStyles from './kpi-card.module.css'

/** 4つ並びのときの並べ方（v7 の見た目）。 */
export const gridFourUpClassName = 'grid grid-cols-2 gap-3 xl:grid-cols-4'

/**
 * 数の帯の包み（Pp3nS・全画面共通）。
 *
 * KpiCard を子に並べるだけで、v8 では1本の帯になる（隙間0・
 * 1px の縦線・角丸は帯の外側だけ）。1枚ずつ KpiCard を置いて
 * いる所は、並べる div をこの部品へ置き換えるだけで帯になる
 * （並べ方 gridClassName はそのまま渡すので v7 は不変）。
 */
export default function KpiBand({
  children,
  gridClassName = gridFourUpClassName,
  className,
  presentation = 'band',
  border,
  ...rest
}: {
  children: ReactNode
  /** 従来の並べ方（`grid grid-cols-2 gap-3 xl:grid-cols-4` など）。v7 の見た目を保つ。 */
  gridClassName?: string
  presentation?: 'band' | 'separated' | 'cards'
  className?: string
  /** 型が下の区切りを持つ帯では、上だけ内側に引く。 */
  border?: 'inset-top'
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  return (
    <div
      className={`${kpiStyles.strip} ${gridClassName}${className ? ` ${className}` : ''}`}
      data-kpi-border={border}
      data-kpi-strip
      data-kpi-presentation={presentation}
      {...rest}
    >
      {children}
    </div>
  )
}
