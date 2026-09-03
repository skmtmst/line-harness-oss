'use client'

import { useEffect, useState } from 'react'
import { api, type BroadcastStats } from '@/lib/api'
import { buildBroadcastKpiCards, countText } from './broadcast-kpi-values'

/** 帯の副題に出す数。中身は `broadcast-kpi-values.ts`。 */
export { countText }

/**
 * 一斉配信の一覧に出す数（設計 `q76C35` ★V6 6-1 一斉配信の帯）。
 *
 * 設計の4枚は **予約中 / 下書き / 今月の配信 / 平均開封率** で、この順。
 * 前は「今月の配信 / 到達 / 平均開封率 / 失敗」で、枚数は合っていても
 * **並びも中身も設計と別物**だった。
 *
 * **「下書き」と「今日」は口が返さないので `—` にする。**
 * `/api/broadcasts/stats` が返すのは 今月の配信・予約中・到達・失敗・
 * 平均開封率 だけ。一覧（`/api/broadcasts`）から数えれば出せそうに見えるが、
 * **一覧はLINEアカウントで絞れるのに集計は絞らない**（`getBroadcastStats`
 * はテナント全体を数える）。基準の違う数を同じ帯に並べると、足しても
 * 合わない4枚になる。取れないものは `—` のままにする。
 */
export default function BroadcastKpis() {
  const [stats, setStats] = useState<BroadcastStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.broadcastStats.get()
        if (!cancelled && res.success) setStats(res.data)
      } catch {
        // 数が出ないだけで一覧は使える。
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const cards = buildBroadcastKpiCards(stats)

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title} className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-secondary text-xs font-medium">{card.title}</p>
          <p className="mt-1 flex items-baseline gap-1">
            {loading ? (
              <span className="bg-canvas-sunken inline-block h-7 w-14 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-ink text-2xl font-bold tabular-nums">
                  {typeof card.value === 'number' && Number.isFinite(card.value)
                    ? card.value.toLocaleString('ja-JP')
                    : '—'}
                </span>
                {/* **数が無いときは単位も出さない。** `—件` は数に見える。 */}
                {typeof card.value === 'number' && Number.isFinite(card.value) && (
                  <span className="text-ink-secondary text-xs">{card.unit}</span>
                )}
              </>
            )}
          </p>
          <p className="text-ink-faint mt-1 text-[11px] leading-relaxed">{card.detail}</p>
        </div>
      ))}
    </div>
  )
}
