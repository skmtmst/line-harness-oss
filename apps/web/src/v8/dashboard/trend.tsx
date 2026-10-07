'use client'

import { useState } from 'react'
import type { DashboardFriendTrendPoint } from '@/lib/api'
import SegmentedControl from '@/components/shared/segmented'
import { barChartTicks } from '@/components/shared/bar-chart'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { STATE_TEXT } from '@/components/shared/not-connected'
import styles from './dashboard.module.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** `2026-09-24` → `{ md: '9/24', jp: '9月24日', week: '木' }`。日付だけの値なので暦で曜日を出す。 */
export function trendDay(date: string): { md: string; jp: string; week: string } {
  const [y, m, d] = date.split('-').map(Number)
  const week = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    : ''
  return { md: `${m}/${d}`, jp: `${m}月${d}日`, week }
}

/** 見出しの脇：「直近7日（9月24日〜9月30日）」。日が無いときは「直近7日」だけ。 */
export function trendRangeNote(trend: DashboardFriendTrendPoint[]): string {
  if (trend.length === 0) return '直近7日'
  return `直近7日（${trendDay(trend[0].date).jp}〜${trendDay(trend[trend.length - 1].date).jp}）`
}

type View = 'chart' | 'table'

/**
 * 友だち数の推移のグラフ（WQmep 段A）。
 * 1日に「登録」と「ブロック」の2本の棒。いちばん新しい日だけ濃い緑と太字。
 * 表に切り替えると、v7 と同じ日ごとの表（前日比・有効友だちつき）を出す。
 */
export function FriendTrend({ trend, loading }: { trend: DashboardFriendTrendPoint[]; loading: boolean }) {
  const [view, setView] = useState<View>('chart')
  const max = Math.max(1, ...trend.flatMap((day) => [day.added, day.blocked]))
  const ticks = barChartTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const pct = (value: number) => `${(Math.max(0, value) / top) * 100}%`
  return (
    <>
      <div className={styles.trendTools}>
        <SegmentedControl
          size="small"
          aria-label="グラフか表か"
          value={view}
          onChange={setView}
          options={[{ value: 'chart', label: 'グラフ' }, { value: 'table', label: '表' }]}
        />
        {view === 'chart' ? (
          <ul className={styles.legend} aria-label="凡例">
            <li><span className={`${styles.swatch} ${styles.swatchAdded}`} aria-hidden="true" />登録</li>
            <li><span className={`${styles.swatch} ${styles.swatchBlocked}`} aria-hidden="true" />ブロック</li>
          </ul>
        ) : null}
      </div>
      {view === 'table' ? (
        <div className={styles.trendTable}><FriendTrendTable trend={trend} loading={loading} /></div>
      ) : loading && trend.length === 0 ? (
        <DelayedSkeleton loading skeleton={<Skeleton className="block h-full w-full" />}>
          <span className="sr-only">{STATE_TEXT.loading}</span>
        </DelayedSkeleton>
      ) : (
        <div className={styles.chart} role="group" aria-label="日ごとの登録とブロック">
          <div className={styles.plot} aria-hidden="true">
            {ticks.slice().reverse().map((tick) => (
              <div key={tick} className={styles.gridline} style={{ bottom: pct(tick) }}>
                <span className={styles.tick}>{tick}</span>
              </div>
            ))}
          </div>
          <div className={styles.columns}>
            {trend.map((day, index) => {
              const label = trendDay(day.date)
              const latest = index === trend.length - 1
              const name = `${label.jp}（${label.week}） 登録${day.added}人・ブロック${day.blocked}人`
              return (
                <div key={day.date} className={styles.column} title={name} aria-label={name} role="img">
                  <div className={styles.bars}>
                    <span className={latest ? styles.barLatest : styles.barAdded} style={{ height: pct(day.added) }} />
                    <span className={styles.barBlocked} style={{ height: pct(day.blocked) }} />
                  </div>
                  <span className={latest ? styles.dayLatest : styles.day}>{`${label.md}（${label.week}）`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
