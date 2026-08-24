'use client'

import { useEffect, useState } from 'react'
import { api, type ListStats } from '@/lib/api'
import SummaryCard, { type SummaryCardProps } from './summary-card'

/**
 * 一覧画面の上部に出す数値カード4枚。
 *
 * タグ・テンプレート・シナリオ・リマインダは、設計上どれも
 * 「Head ＋ KPI4枚 ＋ 本体」という同じ形をしている。枠と取得をここに置き、
 * 何を出すかだけ画面ごとに決める。
 *
 * 数は `/api/list-stats` から4画面ぶんまとめて来る。画面ごとに叩くと
 * 同じ数え方が散らばって、あとで定義がずれる。
 */

export interface KpiSpec {
  title: string
  /** 取れないときは null。「—」を出す。 */
  value: number | null
  unit: string
  detail: string
}

export default function ListKpis({
  build,
  variant = 'v5',
}: {
  build: (stats: ListStats) => KpiSpec[]
  variant?: NonNullable<SummaryCardProps['variant']>
}) {
  const [stats, setStats] = useState<ListStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.listStats.get()
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

  // 読み込み中は枠だけ4つ出す。中身が入ってから高さが変わると、
  // 下の一覧を読んでいる途中で位置がずれる。
  const cards: KpiSpec[] = stats
    ? build(stats)
    : [0, 1, 2, 3].map((i) => ({ title: '', value: null, unit: '', detail: '', key: i }) as KpiSpec)

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card, i) => (
        <SummaryCard key={card.title || i} {...card} loading={loading} variant={variant} />
      ))}
    </div>
  )
}
