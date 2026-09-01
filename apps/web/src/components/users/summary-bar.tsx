'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const fmt = new Intl.NumberFormat('ja-JP')

interface Stats {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
}

type SummaryState = 'loading' | 'ready' | 'error'

const CARD_LABELS = ['統合ユーザー', '紐付く友だち', '重複している行', '重複率'] as const

export default function SummaryBar() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [state, setState] = useState<SummaryState>('loading')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await api.duplicates.stats()
        if (cancelled) return
        if (!res.success) {
          setState('error')
          return
        }
        setStats({
          totalFollowing: res.data.totalFollowing,
          uniquePeople: res.data.uniquePeople,
          friendDups: res.data.friendDups,
        })
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-summary-state="loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-[14px] border border-[#DADDE2] bg-white shadow-[1px_1px_2px_rgba(29,29,31,0.13)]" />
        ))}
      </div>
    )
  }

  if (state === 'error' || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-summary-state="error">
        {CARD_LABELS.map((label) => (
          <Card key={label} label={label} value="—" hint="取得できませんでした" />
        ))}
      </div>
    )
  }

  const dupRate =
    stats.totalFollowing > 0 ? (stats.friendDups / stats.totalFollowing) * 100 : 0

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-summary-state="ready">
      <Card label="統合ユーザー" value={`${fmt.format(stats.uniquePeople)}人`} />
      <Card label="紐付く友だち" value={`${fmt.format(stats.totalFollowing)}件`} />
      {/* friendDups は行ベースの「余分な行数」(SUM(row_cnt - 1))。
          1人が3アカウントに居れば +2 とカウントされる。 */}
      <Card label="重複している行" value={`${fmt.format(stats.friendDups)}件`} hint="複数登録による余分" />
      <Card label="重複率" value={`${dupRate.toFixed(1)}%`} hint="紐付く友だちのうち余分" />
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-[#DADDE2] bg-white p-4 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <div className="text-xs font-medium text-[#565F59]">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-[#1D1D1F]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[#8B938D]">{hint}</div> : null}
    </div>
  )
}
