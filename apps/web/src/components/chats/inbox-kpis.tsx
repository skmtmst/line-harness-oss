'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type InboxStats } from '@/lib/api'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'

/**
 * 受信箱の上部に出す数（設計 `V2 2-1 受信箱` の KPIs）。
 *
 * 設計は4枚。うち「平均の初回返信」は、返信までの時間を記録していないので
 * 出せない。代わりに「1時間以上待たせている件数」を1枚目の内訳に出す。
 * どちらも放置に気づくための数で、役割は同じ。
 *
 * 4枚目には、そのぶん「メールの受信」を出す。設計の3枚目が
 * 「LINE 9 ・ メール 3」と内訳を持っているので、数字としては設計にある。
 */
export default function InboxKpis() {
  const [stats, setStats] = useState<InboxStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await api.chatStats.get()
      if (res.success) setStats(res.data)
    } catch {
      // 数が出ないだけで受信箱そのものは使える。黙って諦める。
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // 対応済みにしたら数が変わる。一覧側が投げる合図に乗る。
    const onRefresh = () => void load()
    window.addEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
  }, [load])

  const cards = [
    {
      title: '返信を待っている人',
      value: stats?.waiting ?? null,
      unit: '件',
      detail:
        stats && stats.waitingOverAnHour > 0
          ? `うち1時間以上が${stats.waitingOverAnHour}件`
          : '1時間以上の放置はありません',
      warn: (stats?.waitingOverAnHour ?? 0) > 0,
    },
    {
      title: '自分が担当',
      value: stats?.mine ?? null,
      unit: '件',
      detail: '対応中のもの',
      warn: false,
    },
    {
      title: '今日の受信',
      value: stats?.todayInbound ?? null,
      unit: '件',
      detail: stats
        ? `LINE ${stats.todayByChannel.line} ・ メール ${stats.todayByChannel.email}`
        : '—',
      warn: false,
    },
    {
      title: 'メールの受信',
      value: stats?.todayByChannel.email ?? null,
      unit: '件',
      detail: '今日ぶん',
      warn: false,
    },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title} className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-secondary text-xs font-medium">{card.title}</p>
          <p className="mt-1 flex items-baseline gap-1">
            {loading ? (
              <span className="bg-canvas-sunken inline-block h-7 w-12 animate-pulse rounded" />
            ) : (
              <>
                <span
                  className={`text-2xl font-bold tabular-nums ${card.warn ? 'text-warning' : 'text-ink'}`}
                >
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
