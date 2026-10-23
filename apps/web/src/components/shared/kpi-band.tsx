import { Children, isValidElement, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import type { KpiCardProps } from './kpi-card'
import kpiStyles from './kpi-card.module.css'

/** 4つ並びのときの並べ方（管理画面 の見た目）。 */
export const gridFourUpClassName = 'grid grid-cols-2 gap-3 xl:grid-cols-4'

/**
 * 数の帯の包み（Pp3nS・全画面共通）。
 *
 * KpiCard を子に並べるだけで、v8 では1本の帯になる（隙間0・
 * 黒7%の右線・帯の上下線だけ）。1枚ずつ KpiCard を置いて
 * いる所は、並べる div をこの部品へ置き換えるだけで帯になる
 * （並べ方 gridClassName はそのまま渡すので 互換経路は不変）。
 */
export default function KpiBand({
  children,
  gridClassName = gridFourUpClassName,
  className,
  presentation = 'band',
  border,
  edgeInset,
  density,
  layout,
  maxColumns,
  ...rest
}: {
  children: ReactNode
  /** 従来の並べ方（`grid grid-cols-2 gap-3 xl:grid-cols-4` など）。管理画面 の見た目を保つ。 */
  gridClassName?: string
  presentation?: 'band'
  className?: string
  /** 型が区切りを持つ帯はinset-top、マスの間だけ区切る帯はdividers。 */
  border?: 'inset-top' | 'dividers'
  /** 親の本文が左右の余白を持つ場合、帯の両端では重ねない。 */
  edgeInset?: 'parent'
  /** 段や引き出しの中で使う小さい帯。 */
  layout?: 'booking' | 'link-row'
  /** Keep every selected metric, wrapping into existing bands after this many columns. */
  maxColumns?: number
  density?: 'compact'
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  if (maxColumns !== undefined && Number.isInteger(maxColumns) && maxColumns > 0) {
    const items = Children.toArray(children)
    if (items.length > maxColumns) {
      const rows: ReactNode[][] = []
      for (let start = 0; start < items.length; start += maxColumns) rows.push(items.slice(start, start + maxColumns))
      return <div data-shared-part="kpi-band-rows" {...rest} style={{ ...rest.style, '--kpi-band-row-columns': maxColumns } as CSSProperties}>
        {rows.map((row, index) => <KpiBand key={index} gridClassName={gridClassName} className={className} presentation={presentation} border={border} edgeInset={edgeInset} density={density} layout={layout}>{row}</KpiBand>)}
      </div>
    }
  }
  const wideValues = Children.toArray(children).some(child => {
    if (!isValidElement<Pick<KpiCardProps, 'value' | 'valueText' | 'valueRange'>>(child)) return false
    if (child.props.valueRange !== undefined) return true
    if (typeof child.props.valueText === 'string' && /\d\s*[/〜～]\s*\d/.test(child.props.valueText)) return true
    return String(child.props.valueText ?? child.props.value ?? '').replace(/[^0-9]/g, '').length >= 9
  })
  return (
    <div
      data-kpi-wide-values={wideValues || undefined}
      className={`${kpiStyles.strip} ${gridClassName}${className ? ` ${className}` : ''}`}
      data-kpi-layout={layout}
      data-kpi-border={border}
      data-kpi-edge-inset={edgeInset}
      data-kpi-density={density}
      data-shared-part="kpi-band"
      data-kpi-strip
      data-kpi-presentation={presentation}
      {...rest}
    >
      {children}
    </div>
  )
}
