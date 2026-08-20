import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * ダッシュボード上部の数値カード。
 *
 * 設計（Pen.dev `V2 1-1 ダッシュボード` の KPIs）は4枚並ぶ。
 * どれも「見出し・大きな数字・単位・内訳の1行」という同じ形なので、
 * ここにまとめる。画面側で個別に組むと、数字の大きさや余白が
 * カードごとにずれる。
 */
export default function KpiCard({
  title,
  value,
  unit,
  detail,
  action,
  loading,
}: {
  title: string
  /** 数。取れないときは null にすると「—」を出す。 */
  value: number | null
  unit: string
  /** 数の下に出す内訳。 */
  detail: ReactNode
  /** 見出しの右に出すリンク。 */
  action?: { label: string; href: string }
  loading?: boolean
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-5 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-ink-secondary text-sm font-medium">{title}</p>
        {action && (
          <Link href={action.href} className="text-action shrink-0 text-xs hover:underline">
            {action.label}
          </Link>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        {loading ? (
          <div className="bg-canvas-sunken h-9 w-24 animate-pulse rounded" />
        ) : (
          <>
            <span className="text-ink text-3xl font-bold tabular-nums">
              {value === null ? '—' : value.toLocaleString('ja-JP')}
            </span>
            <span className="text-ink-secondary text-sm">{unit}</span>
          </>
        )}
      </div>

      <p className="text-ink-faint mt-2 text-xs leading-relaxed">{detail}</p>
    </div>
  )
}
