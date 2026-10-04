'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { api, type FriendStats } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import Notice from '@/components/shared/notice'
import { formatNumber } from '@/lib/format'

/** Pencil ★V6（`zZMNG`）の上部カード。数え方は既存APIのままにする。 */
export default function FriendKpis() {
  const theme = useAdminTheme()
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
      detail: stats ? (theme !== 'v8' ? `総友だち ${formatNumber(stats.total)}人` : stats.activeMonthDelta == null ? `総友だち ${formatNumber(stats.total)}人・前月の記録なし` : `前月末 ${formatNumber(stats.activeLastMonth ?? 0)}人（${stats.activeMonthDelta >= 0 ? '+' : ''}${formatNumber(stats.activeMonthDelta)}）`) : '—',
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
        <Notice
          tone="danger"
          className="mb-3.5"
          action={(
            <button
              type="button"
              onClick={() => void load(selectedAccountId)}
              className="font-semibold text-action underline"
            >
              再読み込み
            </button>
          )}
        >
          友だち集計を読み込めませんでした。
        </Notice>
      ) : null}
      {/*
        ★V8（夕10・夕11）：一覧型では枠線付きのカードのまま（数の帯は
        分析型だけ）。v7 はこれまでの詰めた形（cardV6Tight）、v8 は
        cardV6 の実寸（16/20・間8・高122）を使う。
      */}
      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        {cards.map((card) => (
          <KpiCard key={card.title} {...card} loading={loading} variant="v6" className={kpiStyles.cardV6Tight} />
        ))}
      </div>
    </div>
  )
}
