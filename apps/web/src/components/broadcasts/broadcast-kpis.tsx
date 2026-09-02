'use client'

import { useEffect, useState } from 'react'
import { api, type BroadcastStats } from '@/lib/api'

/**
 * 帯の副題に出す数。
 *
 * **口が想定の形を返さなくても `undefined` を画面に出さない。**
 * `予約中 undefined` が実際に出ていた（撮影用のモックが
 * `/api/broadcasts/stats` を持たず、別の形が返っていた）。
 * 数が無いなら `—` にして、単位も付けない。
 */
export function countText(value: unknown, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ja-JP')}${unit}`
    : '—'
}

/**
 * 一斉配信の一覧に出す数（設計 `V2 4-2 一斉配信` の KPIs）。
 *
 * 設計は「今月の配信 / 到達 / 平均開封率 / 今月の残枠」の4枚。
 * 残枠はダッシュボードと同じく LINE の送信枠から取るが、この画面では
 * それだけのために外部APIを叩くのは重いので、代わりに「失敗」を出す。
 * 到達の隣に失敗があるほうが、配信の成否を1か所で読める。
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

  const cards = [
    {
      title: '今月の配信',
      value: stats?.thisMonth ?? null,
      unit: '件',
      detail: `予約中 ${countText(stats?.scheduled, '件')}`,
    },
    {
      title: '到達',
      value: stats?.delivered ?? null,
      unit: '通',
      detail: `失敗 ${countText(stats?.failed, '通')}`,
    },
    {
      title: '平均開封率',
      value: stats?.openRate ?? null,
      unit: '%',
      // LINEは20人未満の配信だと開封数を返さない。0として混ぜると
      // 平均が不当に下がるので、その配信は外している。
      detail: '過去28日 ・ 20人未満の配信は除く',
    },
    {
      title: '失敗',
      value: stats?.failed ?? null,
      unit: '通',
      detail: '過去28日',
    },
  ]

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
