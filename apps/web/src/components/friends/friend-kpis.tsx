'use client'

import { useEffect, useState } from 'react'
import { api, type FriendStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

/** V4の上部カード。数え方はダッシュボードと共通にしている。 */
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
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-design="V4FriendKpis">
      {cards.map((card) => (
        <div key={card.title} className="rounded-[14px] border border-[#DADDE2] bg-white p-4 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
          <p className="text-xs font-medium text-[#565F59]">{card.title}</p>
          <p className="mt-1 flex items-baseline gap-1">
            {loading ? (
              <span className="inline-block h-7 w-14 animate-pulse rounded bg-[#F6F6F8]" />
            ) : (
              <>
                <span className="text-2xl font-bold tabular-nums text-[#1D1D1F]">
                  {card.value === null ? '—' : card.value.toLocaleString('ja-JP')}
                </span>
                <span className="text-xs text-[#565F59]">{card.unit}</span>
              </>
            )}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8B938D]">{card.detail}</p>
        </div>
      ))}
    </div>
  )
}
