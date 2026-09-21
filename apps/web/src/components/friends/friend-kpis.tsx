'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FriendStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import SummaryCard from '@/components/shared/summary-card'

/** Pencil ★V6（`zZMNG`）の上部カード。数え方は既存APIのままにする。 */
export default function FriendKpis() {
  const { selectedAccountId } = useAccount()
  const [stats, setStats] = useState<FriendStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /*
   * FRIEND-08: 応答の世代を照合する。アカウント切替や再試行で
   * 新しい要求を出したあとに、古い要求の応答が届いても捨てる。
   */
  const requestRef = useRef(0)

  const load = useCallback(async (accountId: string | null) => {
    const requestId = ++requestRef.current
    const current = () => requestRef.current === requestId
    /*
     * 切替直後に前のアカウントの人数を残さない。取り直す前に必ず
     * 空へ戻し、失敗は0件や前の値で代用せず「取れなかった」と
     * 再試行を出す。
     */
    setStats(null)
    setFailed(false)
    setLoading(true)
    try {
      const res = await api.friendStats.get(accountId ?? undefined)
      if (!current()) return
      if (res.success) {
        setStats(res.data)
      } else {
        setFailed(true)
      }
    } catch {
      if (current()) setFailed(true)
    } finally {
      if (current()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(selectedAccountId)
  }, [selectedAccountId, load])

  const diff = stats ? stats.addedThisMonth - stats.addedLastMonth : 0

  const cards = [
    {
      title: '有効友だち',
      value: stats?.active ?? null,
      unit: '人',
      detail: stats ? `総友だち ${stats.total.toLocaleString('ja-JP')}人` : '—',
      badge: stats?.total ? `${Math.round((stats.active / stats.total) * 100)}%` : undefined,
    },
    {
      title: 'ブロック・非表示',
      value: stats ? stats.blockedByThem + stats.hiddenByUs : null,
      unit: '人',
      detail: stats ? `相手から ${stats.blockedByThem} ・ 自分から ${stats.hiddenByUs}` : '—',
      badge: stats?.total ? `${Math.round(((stats.blockedByThem + stats.hiddenByUs) / stats.total) * 100)}%` : undefined,
      badgeTone: 'neutral' as const,
    },
    {
      title: '未対応',
      value: stats?.unanswered ?? null,
      unit: '人',
      detail: stats ? `対応済み ${stats.resolved}` : '—',
      badge: stats ? '要確認' : undefined,
      badgeTone: 'danger' as const,
    },
    {
      title: '今月の追加',
      value: stats?.addedThisMonth ?? null,
      unit: '人',
      // 前月比は「先月まるごと」との比較。月初は必ずマイナスに見えるので、
      // その旨を添える。数字だけ出すと減ったように読める。
      detail: stats ? `前月 ${stats.addedLastMonth}人（${diff >= 0 ? '+' : ''}${diff}）` : '—',
      badge: stats ? `${diff >= 0 ? '+' : ''}${stats.addedThisMonth}` : undefined,
    },
  ]

  return (
    <div data-design="V6FriendKpis" data-design-node="zZMNG">
      {failed && !loading ? (
        <div className="mb-3.5 flex items-center justify-between rounded-card border border-status-danger-border bg-status-danger-soft px-4 py-2.5 text-xs text-danger">
          <span>友だち集計を読み込めませんでした。</span>
          <button
            type="button"
            onClick={() => void load(selectedAccountId)}
            className="font-semibold text-action underline"
          >
            再読み込み
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        {cards.map((card) => (
          <SummaryCard key={card.title} {...card} loading={loading} variant="v6" className="!min-h-25 !gap-1 !px-4 !py-3.5" />
        ))}
      </div>
    </div>
  )
}
