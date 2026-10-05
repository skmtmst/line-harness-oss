'use client'

import { Children, useState, type ReactElement, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import kpiStyles from '@/components/shared/kpi-card.module.css'

/**
 * KPIの折りたたみ（UI監査 #975 U060）。
 *
 * 390pxでは集計カードが4枚以上縦に積まれ、検索・一覧・作成などの日常作業が
 * 初期画面の外へ押し出されていた。狭い幅では先頭の指標だけを出し、
 * 残りは「集計を見る」で開く。640px以上では従来どおり全件を並べる。
 *
 * 使い方：従来の `<div className="grid …">` をこの部品へ置き換える。
 * `gridClassName` には従来の grid クラスをそのまま渡す。
 */
export default function KpiCollapse({
  children,
  className,
  gridClassName,
  mobileVisible = 2,
  ...rest
}: {
  /** 集計カード（先頭 `mobileVisible` 件は常に出す） */
  children: ReactNode
  /** 外側の枠へ付けるクラス（余白や max-width など）。 */
  className?: string
  /** 従来の並べ方のクラス。単一のグリッドへそのまま使う。 */
  gridClassName: string
  /** 狭い幅で最初から出す件数。日常作業に必要な指標を前へ並べる前提で 2。 */
  mobileVisible?: number
  /** `data-design` など、外側の枠へ付ける属性。 */
  [key: `data-${string}`]: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const items = Children.toArray(children)
  const tail = items.slice(mobileVisible)

  const head = items.slice(0, mobileVisible)
  const tailKeys = tail.map((item, tailIndex) =>
    (item as ReactElement).key ?? `kpi-tail-${tailIndex}`,
  )

  return (
    <div data-kpi-collapse className={className} {...rest}>
      {/*
        全件を1つのグリッドへ並べる。先頭と残りを別グリッドに分けると
        `lg:grid-cols-4` でも各グリッドへ2件しか入らず、PCでも2×2の
        左半分だけの表示になっていた（DASH-22）。狭い幅での非表示は
        共通部品側の包み div で制御する。各カードへ `className` を
        付け足す方式だと、`className` を受け取らないカード（R171 の
        Metric など）は隠せず4枚とも残ってしまう。
      */}
      <div className={`${kpiStyles.strip} ${gridClassName}`} data-kpi-strip data-kpi-presentation="band">
        {head}
        {tail.map((item, tailIndex) => (
          <div
            key={tailKeys[tailIndex]}
            className={open ? 'min-w-0' : 'min-w-0 max-sm:hidden'}
          >
            {item}
          </div>
        ))}
      </div>
      {tail.length ? (
        // 表示制御は共通部品へ渡せない（display-class-on-part）。外側の div で狭い幅だけに見せる。
        <div className="mt-2 sm:hidden">
          <Button
            variant="secondary"
            className="w-full"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? '集計を閉じる' : `残り${tail.length}件の集計を見る`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
