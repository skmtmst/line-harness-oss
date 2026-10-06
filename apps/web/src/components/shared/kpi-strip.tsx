import type { HTMLAttributes } from 'react'

/** 画面の絵が帯なら band、独立したカードなら cards。v7 は呼び出し元の配置を使う。 */
export default function KpiStrip({ density = 'comfortable', presentation = 'band', ...props }: HTMLAttributes<HTMLDivElement> & {
  density?: 'compact' | 'comfortable'
  presentation?: 'band' | 'cards'
}) {
  return <div {...props} data-kpi-strip data-kpi-density={density} data-kpi-presentation={presentation} />
}
