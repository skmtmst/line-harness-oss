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

/**
 * 一斉配信の一覧に出す4枚（設計 V6 `q76C35`）。
 *
 * 設計は **予約中 ／ 下書き ／ 今月の配信 ／ 平均開封率** の順。
 * 以前は「今月の配信・到達・平均開封率・失敗」を出していた（V2 の 4-2 を
 * 写したもの）。並びも中身も設計と違っていた。
 *
 * **下書きの件数は取得元が無い。** `/api/broadcasts/stats` は今月の配信・
 * 予約中・到達・失敗・平均開封率しか返さない。一覧（`/api/broadcasts`）は
 * 上限なしで全件返るので数えられそうに見えるが、**一覧はLINEアカウントで
 * 絞れるのに集計は絞らない**（`getBroadcastStats` はテナント全体を数える）。
 * 同じ帯に基準の違う数を並べると、足しても合わない4枚になる。
 * 数を作らず `—` にして、口が揃うのを待つ。
 *
 * 「今日の予約」も同じ理由で `—`。設計は「今日 1件」と書いているが、
 * 今日ぶんだけを数える口が無い。
 */
export function buildBroadcastKpiCards(stats: BroadcastKpiStats | null): BroadcastKpiCard[] {
  return [
    {
      title: '予約中',
      value: stats?.scheduled ?? null,
      unit: '件',
      detail: '今日 —（未取得）',
    },
    {
      title: '下書き',
      value: null,
      unit: '件',
      detail: '編集途中（件数は未取得）',
    },
    {
      title: '今月の配信',
      value: stats?.thisMonth ?? null,
      unit: '件',
      detail: stats?.delivered == null ? '—' : `${stats.delivered.toLocaleString('ja-JP')}人へ到達`,
    },
    {
      title: '平均開封率',
      value: stats?.openRate ?? null,
      unit: '%',
      // LINEは20人未満の配信だと開封数を返さない。0として混ぜると
      // 平均が不当に下がるので、その配信は外している。
      detail: '過去28日 ・ 20人未満の配信は除く',
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
