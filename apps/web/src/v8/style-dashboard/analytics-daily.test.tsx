// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndustryStyle, StyleAnalyticsData, StyleMetric, StyleSnapshot } from '@line-crm/shared'
import { toAnalytics } from './adapter'
import { StyleAnalyticsView } from './analytics'

const metric = (value: number | null, status: StyleMetric['status'] = 'available'): StyleMetric => ({ value, status, unit: '件', formula: '開始日が期間内' })
const daily: NonNullable<StyleAnalyticsData['dailyComparison']> = {
  current: [
    { date: '2026-10-14', metrics: { bookings: metric(4), visits: metric(2) } },
    { date: '2026-10-15', metrics: { bookings: metric(0), visits: metric(0) } },
  ],
  previous: [
    { date: '2026-10-12', metrics: { bookings: metric(8), visits: metric(5) } },
    { date: '2026-10-13', metrics: { bookings: metric(0), visits: metric(0) } },
  ],
}
function data(style: IndustryStyle = 'restaurant', comparison: StyleAnalyticsData['dailyComparison'] = daily) {
  const snapshot: StyleSnapshot & { analytics: StyleAnalyticsData } = {
    style, from: '2026-10-13T15:00:00Z', to: '2026-10-15T15:00:00Z', asOf: '2026-10-21T00:00:00Z', timeZone: 'Asia/Tokyo', dateBasis: 'visit', range: 'month',
    metrics: { bookings: metric(4) }, previous: {}, items: [], newBookings: [], resultId: 'fixture',
    analytics: { dailyComparison: comparison, daily: [{ date: '2026-10-14', bookings: 999, visits: 888 }] },
  }
  return toAnalytics(style, snapshot, style === 'restaurant' ? 'reservations' : 'overview', {})
}
function show(value: ReturnType<typeof data>) {
  return render(<StyleAnalyticsView data={value} error={false} onTab={() => {}} onRetry={() => {}} onRowOpen={() => {}} />)
}
afterEach(cleanup)

describe('日別集計のAPI接続', () => {
  it.each<[IndustryStyle, number, number]>([['restaurant', 4, 8], ['salon', 2, 5], ['consult', 2, 5], ['lesson', 2, 5]])('%sは日別の正規指標を使い、前期間と0件の日を維持する', (style, current, previous) => {
    const value = data(style)
    expect(value.chart?.points).toEqual([
      { label: '2026-10-14', now: current, prev: previous, previousLabel: '2026-10-12' },
      { label: '2026-10-15', now: 0, prev: 0, previousLabel: '2026-10-13' },
    ])
    expect(value.chart?.max).toBe(previous)
    show(value)
    const plot = screen.getByRole('img')
    expect(plot.querySelector('[title="2026-10-14：この期間 ' + current + '・比較期間 2026-10-12：' + previous + '"] i[data-k="prev"]')?.getAttribute('style')).toContain('100%')
    expect(plot.querySelector('[title="2026-10-15：この期間 0・比較期間 2026-10-13：0"]')?.querySelectorAll('i')).toHaveLength(2)
    expect(screen.getByText(/前の期間/)).toBeTruthy()
  })

  it('前期間の実際の0件も比較を表示し、前期間がなければ棒も0も作らない', () => {
    const zeroPrevious = { current: daily.current, previous: daily.previous?.map(row => ({ ...row, metrics: { bookings: metric(0) } })) }
    show(data('restaurant', zeroPrevious))
    expect(screen.getByText(/前の期間/)).toBeTruthy()
    cleanup()
    const value = data('restaurant', { current: daily.current })
    expect(value.chart?.points.map(p => p.prev)).toEqual([null, null])
    show(value)
    expect(screen.queryByText(/前の期間/)).toBeNull()
    expect(screen.getByRole('img').querySelector('i[data-k="prev"]')).toBeNull()
    expect(screen.getByRole('img').querySelector('[title="2026-10-14：この期間 4"]')).toBeTruthy()
  })

  it('未設定・標本不足・欠けた日を0件にせず、取得済みの0件と区別する', () => {
    const value = data('restaurant', {
      current: [{ date: '2026-10-14', metrics: { bookings: metric(null, 'unconfigured') } }, daily.current[1]],
      previous: [{ date: '2026-10-12', metrics: { bookings: metric(7, 'insufficient_sample') } }],
    })
    expect(value.chart?.points.map(p => [p.now, p.prev])).toEqual([[null, null], [0, null]])
    show(value)
    const missing = screen.getByRole('img').querySelector('[title="2026-10-14：この期間 未取得・比較期間 2026-10-12：未取得"]')
    expect(missing).toBeTruthy()
    expect(missing?.querySelectorAll('i')).toHaveLength(0)
    expect(screen.getByRole('img').querySelector('[title="2026-10-15：この期間 0"] i[data-k="now"]')).toBeTruthy()
  })

  it('当期の値が一つもない場合は旧dailyを使わず未取得を示す', () => {
    const value = data('restaurant', { current: [{ date: '2026-10-14', metrics: {} }] })
    show(value)
    expect(screen.getByText('日ごとの集計はまだ取得できていません。')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    cleanup()
    const absent = data('restaurant', { current: [] })
    show(absent)
    expect(screen.getByText('日ごとの集計はまだ取得できていません。')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('前年など日付が離れた比較でも元の日付を保ち、対応のない日を埋めない', () => {
    const value = data('restaurant', { current: daily.current, previous: [{ date: '2025-10-14', metrics: { bookings: metric(6) } }] })
    expect(value.chart?.points.map(p => [p.previousLabel, p.prev])).toEqual([['2025-10-14', 6], [undefined, null]])
    expect(value.chart?.axis).toEqual(['10/14', '10/15'])
  })
})

it('サロンの来店グラフは予約と異なる実来店・欠測を保ち、予約数へ戻さない', () => {
  const value = data('salon', {
    current: [{ date: '2026-10-14', metrics: { bookings: metric(99), visits: metric(null, 'unconfigured') } }, daily.current[1]],
    previous: [{ date: '2026-10-12', metrics: { bookings: metric(80), visits: metric(5) } }],
  })
  expect(value.chart?.title).toBe('日ごとの来店（来店日で数える）')
  expect(value.chart?.points.map(point => [point.now, point.prev])).toEqual([[null, 5], [0, null]])
  show(value)
  const plot = screen.getByRole('img', { name: '日ごとの来店（来店日で数える）のグラフ' })
  expect(plot.querySelector('[title="2026-10-14：この期間 未取得・比較期間 2026-10-12：5"] i[data-k="now"]')).toBeNull()
  expect(plot.querySelector('[title="2026-10-15：この期間 0"] i[data-k="now"]')).toBeTruthy()
})
