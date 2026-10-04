'use client'

import { useEffect, useState } from 'react'
import SegmentedControl from '@/components/shared/segmented'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import {
  bookingApi,
  type BookingSalesSummary,
  type BookingSalesSummaryMenu,
} from '@/lib/api'
import { formatNumber, formatYen } from '@/lib/format'
import styles from './sales-v8.module.css'
import {
  formatCountDelta,
  formatPointDelta,
  formatRevenueDelta,
  salesPeriodRange,
  SALES_PERIOD_COMPARE_LABEL,
  type SalesPeriodKey,
} from './sales-period'

const PERIOD_OPTIONS: Array<{ value: SalesPeriodKey; label: string }> = [
  { value: 'week', label: '今週' },
  { value: 'month', label: '今月' },
  { value: 'quarter', label: '3か月' },
]

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']
/** strftime('%w') の並び（日曜=0）を月曜始まりに直す。 */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

type TileKey = 'revenue' | 'bookings' | 'cancelRate' | 'noshowRate'

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`
}

function topMenus(menus: BookingSalesSummaryMenu[], pick: (menu: BookingSalesSummaryMenu) => number): BookingSalesSummaryMenu[] {
  return [...menus].sort((a, b) => pick(b) - pick(a)).slice(0, 5)
}

/**
 * 予約からの売上（B-1 X26oo）。予約管理 → 売上。
 * 数は実データだけ。取れない数（読み込み前・失敗）は「—」。
 */
export default function BookingSalesPage() {
  const { selectedAccountId } = useAccount()
  const [period, setPeriod] = useState<SalesPeriodKey>('month')
  const [summary, setSummary] = useState<BookingSalesSummary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [openTile, setOpenTile] = useState<TileKey | null>(null)

  usePageTitle('予約からの売上')
  usePageCrumbs([
    { label: '予約管理', href: '/booking/bookings' },
    { label: '売上' },
  ])

  useEffect(() => {
    if (!selectedAccountId) {
      setStatus('ready')
      setSummary(null)
      return
    }
    let alive = true
    setStatus('loading')
    const range = salesPeriodRange(period)
    bookingApi.getSalesSummary(selectedAccountId, range.from, range.to).then(
      (response) => {
        if (!alive) return
        setSummary(response.data)
        setStatus('ready')
      },
      () => {
        if (!alive) return
        setSummary(null)
        setStatus('error')
      },
    )
    return () => {
      alive = false
    }
  }, [selectedAccountId, period])

  if (!selectedAccountId) {
    return <p className={styles.center}>LINEアカウントを選んでください。</p>
  }
  if (status === 'loading' || !summary) {
    return (
      <div>
        <p className={styles.center}>{status === 'error' ? '売上を読み込めませんでした。通信状態を確認してください。' : '読み込んでいます…'}</p>
      </div>
    )
  }

  const { total, previous, menus, weekdays } = summary
  const compareLabel = SALES_PERIOD_COMPARE_LABEL[period]
  const revenueDelta = formatRevenueDelta(total.revenue, previous.revenue)
  const weekdayByNumber = new Map(weekdays.map((day) => [day.weekday, day]))
  const weekCounts = WEEKDAY_ORDER.map((number) => weekdayByNumber.get(number)?.bookings ?? 0)
  const peak = Math.max(0, ...weekCounts)
  const maxMenuRevenue = Math.max(0, ...menus.map((menu) => menu.revenue))

  const tiles: Array<{
    key: TileKey
    label: string
    value: string
    sub: string
    detailTitle: string
    detailRows: Array<{ name: string; value: string }>
  }> = [
    {
      key: 'revenue',
      label: '売上（確定した予約）',
      value: formatYen(total.revenue),
      sub: revenueDelta ? `${compareLabel}${revenueDelta}` : '—',
      detailTitle: 'メニュー別の売上',
      detailRows: topMenus(menus, (menu) => menu.revenue).map((menu) => ({
        name: menu.menu_name,
        value: formatYen(menu.revenue),
      })),
    },
    {
      key: 'bookings',
      label: '予約数',
      value: `${formatNumber(total.bookings)}件`,
      sub: `${compareLabel}${formatCountDelta(total.bookings, previous.bookings)}`,
      detailTitle: 'メニュー別の予約数',
      detailRows: topMenus(menus, (menu) => menu.bookings).map((menu) => ({
        name: menu.menu_name,
        value: `${formatNumber(menu.bookings)}件`,
      })),
    },
    {
      key: 'cancelRate',
      label: 'キャンセル率',
      value: percent(total.cancelRate),
      sub: `${compareLabel}${formatPointDelta(total.cancelRate, previous.cancelRate)}`,
      detailTitle: 'メニュー別のキャンセル率',
      detailRows: topMenus(menus, (menu) => menu.cancelRate).map((menu) => ({
        name: menu.menu_name,
        value: percent(menu.cancelRate),
      })),
    },
    {
      key: 'noshowRate',
      label: '来なかった率',
      value: percent(total.noshowRate),
      sub: `${formatNumber(total.noshow)}件`,
      detailTitle: 'メニュー別の来なかった率',
      detailRows: topMenus(menus, (menu) => menu.noshowRate).map((menu) => ({
        name: menu.menu_name,
        value: percent(menu.noshowRate),
      })),
    },
  ]
  const openDetail = openTile ? tiles.find((tile) => tile.key === openTile) : null

  return (
    <div>
      <div className={styles.head}>
        <SegmentedControl
          aria-label="集計する期間"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(next) => {
            setPeriod(next)
            setOpenTile(null)
          }}
        />
      </div>

      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className={styles.tile}
            aria-expanded={openTile === tile.key}
            onClick={() => setOpenTile((current) => (current === tile.key ? null : tile.key))}
          >
            <div className={styles.tileLabel}>{tile.label}</div>
            <div className={styles.tileValue}>{tile.value}</div>
            <div className={styles.tileSub}>{tile.sub}</div>
          </button>
        ))}
      </div>

      <div className={`${styles.detail} ${openDetail ? styles.detailOpen : ''}`}>
        {openDetail ? (
          <div className={styles.detailCard}>
            <h2 className={styles.detailTitle}>{openDetail.detailTitle}</h2>
            {openDetail.detailRows.length === 0 ? (
              <p className={styles.tileSub}>明細はありません。</p>
            ) : (
              openDetail.detailRows.map((row) => (
                <div key={row.name} className={styles.detailRow}>
                  <span className={styles.detailName} title={row.name}>{row.name}</span>
                  <span className={styles.detailValue}>{row.value}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.panels}>
        <section className={styles.panel} aria-label="メニュー別">
          <h2 className={styles.panelTitle}>メニュー別</h2>
          {menus.length === 0 ? (
            <p className={styles.tileSub}>この期間の予約はありません。</p>
          ) : (
            menus.map((menu) => (
              <div key={menu.menu_id} className={styles.menuRow}>
                <span className={styles.menuName} title={menu.menu_name}>{menu.menu_name}</span>
                <span className={styles.menuMeta}>
                  {formatYen(menu.revenue)}・{formatNumber(menu.bookings)}件・キャンセル{percent(menu.cancelRate)}
                </span>
                <span className={styles.menuTrack} aria-hidden="true">
                  <span
                    className={styles.menuFill}
                    style={{ width: `${maxMenuRevenue > 0 ? Math.max(2, Math.round((menu.revenue / maxMenuRevenue) * 100)) : 0}%` }}
                  />
                </span>
              </div>
            ))
          )}
        </section>

        <section className={styles.panel} aria-label="曜日別の予約数">
          <h2 className={styles.panelTitle}>曜日別の予約数</h2>
          <div className={styles.weekRow}>
            {WEEKDAY_ORDER.map((number, index) => {
              const count = weekCounts[index]
              const isPeak = peak > 0 && count === peak
              return (
                <div key={number} className={styles.weekCol}>
                  <span className={styles.weekCount}>{formatNumber(count)}</span>
                  <span className={styles.weekTrack} aria-hidden="true">
                    <span
                      className={`${styles.weekFill} ${isPeak ? styles.weekFillPeak : ''}`}
                      style={{ height: `${peak > 0 ? Math.max(3, Math.round((count / peak) * 100)) : 0}%` }}
                    />
                  </span>
                  <span className={styles.weekLabel}>{WEEKDAYS[index]}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <p className={styles.note}>
        売上は確定した予約×メニューの料金。決済を入れた店は実際の入金で数える。数のタイルを押すと、そのタイルが広がって明細へ。
        {summary.revenueSource === 'paid' ? '（今は決済の入金で数えています）' : null}
      </p>
    </div>
  )
}
