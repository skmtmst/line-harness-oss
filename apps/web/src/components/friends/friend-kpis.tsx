'use client'

import { useEffect, useState } from 'react'
import { api, type FriendStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

/**
 * 友だち画面の上部に出す数（設計 `V2 2-2 友だち` の KPIs）。
 *
 * 数え方はダッシュボードの `/api/dashboard/overview` と揃えている。
 * 同じ「有効友だち」が画面によって違う数だと、どちらが正しいのか
 * 分からなくなる。
 */
export default function FriendKpis() {
  const { selectedAccountId } = useAccount()
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await api.friendStats.get(selectedAccountId ?? undefined)
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
  }, [selectedAccountId])

  const diff = stats ? stats.addedThisMonth - stats.addedLastMonth : 0

  const cards = [
    {
      title: '有効友だち',
      value: stats?.active ?? null,
      unit: '人',
      detail: stats ? `総数 ${stats.total.toLocaleString('ja-JP')}人` : '—',
    },
    {
      title: 'ブロック / 非表示',
      value: stats ? stats.blockedByThem + stats.hiddenByUs : null,
      unit: '人',
      detail: stats ? `相手から ${stats.blockedByThem} ・ 自分から ${stats.hiddenByUs}` : '—',
    },
    {
      title: '未対応',
      value: stats?.unanswered ?? null,
      unit: '人',
      detail: stats ? `対応済 ${stats.resolved}` : '—',
    },
    {
      title: '今月の追加',
      value: stats?.addedThisMonth ?? null,
      unit: '人',
      // 前月比は「先月まるごと」との比較。月初は必ずマイナスに見えるので、
      // その旨を添える。数字だけ出すと減ったように読める。
      detail: stats ? `前月 ${stats.addedLastMonth}人（${diff >= 0 ? '+' : ''}${diff}）` : '—',
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
                  {card.value === null ? '—' : card.value.toLocaleString('ja-JP')}
                </span>
                <span className="text-ink-secondary text-xs">{card.unit}</span>
              </>
            )}
          </p>
          <p className="text-ink-faint mt-1 text-[11px] leading-relaxed">{card.detail}</p>
        </div>
      ))}
    </div>
  )
}
