'use client'

import { useCallback, useEffect, useState } from 'react'
import SummaryCard from '@/components/shared/summary-card'
import { api } from '@/lib/api'
import { createLatestRequestGuard } from './summary-request-guard'

interface Stats {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
}

type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * 統合ユーザー（設計 `r7eSi`）の指標カード。
 *
 * 面・角丸・文字は共通 SummaryCard に任せる。ここで手書きしていたときは
 * 値が24pxになっていて、設計の22pxと1画面ぶんずれていた。
 */
export default function SummaryBar() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [requestGuard] = useState(createLatestRequestGuard)

  const load = useCallback(async () => {
    const requestGeneration = requestGuard.begin()
    setStats(null)
    setStatus('loading')

    try {
      const res = await api.duplicates.stats()
      if (!requestGuard.isCurrent(requestGeneration)) return

      if (!res.success) {
        setStatus('error')
        return
      }

      setStats({
        totalFollowing: res.data.totalFollowing,
        uniquePeople: res.data.uniquePeople,
        friendDups: res.data.friendDups,
      })
      setStatus('ready')
    } catch {
      if (requestGuard.isCurrent(requestGeneration)) setStatus('error')
    }
  }, [requestGuard])

  useEffect(() => {
    void load()
    return () => requestGuard.invalidate()
  }, [load, requestGuard])

  const loading = status === 'loading'
  const failure = status === 'error'
  const detailOf = (ready: string) =>
    loading ? '読み込んでいます' : failure ? <FailureDetail onRetry={load} /> : ready
  const dupRate =
    stats && stats.totalFollowing > 0 ? (stats.friendDups / stats.totalFollowing) * 100 : stats ? 0 : null

  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      data-design-node="r7eSi"
      data-users-summary="v6"
      data-summary-state={status}
    >
      <SummaryCard
        title="統合ユーザー"
        value={stats?.uniquePeople ?? null}
        unit="人"
        detail={detailOf('重複を1人にまとめた数')}
        loading={loading}
      />
      <SummaryCard
        title="紐付く友だち"
        value={stats?.totalFollowing ?? null}
        unit="件"
        detail={detailOf('各アカウントの友だち登録')}
        loading={loading}
      />
      {/*
        friendDups は行ベースの「余分な登録行数」(SUM(row_cnt - 1))。
        1人が3アカウントに居れば +2 と数える。通数でも金額でもない。
      */}
      <SummaryCard
        title="重複している行"
        value={stats?.friendDups ?? null}
        unit="件"
        detail={detailOf('複数登録による余分')}
        loading={loading}
      />
      <SummaryCard
        title="重複率"
        value={dupRate === null ? null : Number(dupRate.toFixed(1))}
        unit="%"
        detail={detailOf('紐付く友だちのうち余分')}
        loading={loading}
      />
    </div>
  )
}

function FailureDetail({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      読み込めませんでした
      <button
        type="button"
        onClick={onRetry}
        className="ml-1.5 font-semibold text-action underline hover:no-underline"
      >
        再読み込み
      </button>
    </>
  )
}
