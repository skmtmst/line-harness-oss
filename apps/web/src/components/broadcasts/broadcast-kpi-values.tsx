import React from 'react'

type BroadcastKpiStats = {
  thisMonth?: number
  scheduled?: number
  delivered?: number
  failed?: number
  openRate?: number | null
}

export type BroadcastKpiCard = {
  title: string
  value: number | null
  unit: string
  detail: string
}

/** APIの一部が欠けても、未取得を0やundefinedに置き換えない。 */
export function buildBroadcastKpiCards(stats: BroadcastKpiStats | null): BroadcastKpiCard[] {
  return [
    {
      title: '今月の配信',
      value: stats?.thisMonth ?? null,
      unit: '件',
      detail: stats?.scheduled == null ? '—' : `予約中 ${stats.scheduled.toLocaleString('ja-JP')}件`,
    },
    {
      title: '到達',
      value: stats?.delivered ?? null,
      unit: '通',
      detail: stats?.failed == null ? '—' : `失敗 ${stats.failed.toLocaleString('ja-JP')}通`,
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
}

/** 取得できていない数は、実値0と区別して「—」だけを出す。 */
export function BroadcastKpiValue({ value, unit }: Pick<BroadcastKpiCard, 'value' | 'unit'>) {
  if (value === null) return <span className="text-ink-faint text-2xl font-bold tabular-nums">—</span>
  return (
    <>
      <span className="text-ink text-2xl font-bold tabular-nums">{value.toLocaleString('ja-JP')}</span>
      <span className="text-ink-secondary text-xs">{unit}</span>
    </>
  )
}
