import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import DashboardFreshness, { dashboardFreshnessText, formatDashboardAsOf } from './freshness'

describe('ダッシュボードの更新時刻と鮮度表示(#759)', () => {
  // 比較の「今日」は JST 2026-09-13（UTC 09-13T15:00 は JST 09-14 0:00）。
  const sameDay = new Date('2026-09-13T06:00:00.000Z') // JST 2026-09-13 15:00

  it('取得元の時刻を日本時間の「更新 HH:MM」で表示する', () => {
    expect(formatDashboardAsOf('2026-09-13T03:04:00.000Z', sameDay)).toBe('12:04')
    expect(dashboardFreshnessText('fresh', '2026-09-13T03:04:00.000Z', undefined, sameDay)).toBe('更新 12:04')
  })

  it('日付が違うときは日付を添える（DASH-16。時刻だけだと前日の値を今日と誤読する）', () => {
    expect(formatDashboardAsOf('2026-09-12T03:04:00.000Z', sameDay)).toBe('9/12 12:04')
    expect(formatDashboardAsOf('2026-09-01T03:04:00.000Z', sameDay)).toBe('9/1 12:04')
    // 前日との境目。JSTで日が変わる瞬間は日付付きに切り替わる。
    expect(formatDashboardAsOf('2026-09-12T14:59:00.000Z', sameDay)).toBe('9/12 23:59')
    expect(formatDashboardAsOf('2026-09-12T15:00:00.000Z', sameDay)).toBe('00:00')
  })

  it('stale・取得失敗・部分取得を同じ表示にしない', () => {
    expect(dashboardFreshnessText('stale', '2026-09-13T03:04:00.000Z', undefined, sameDay)).toBe('最終更新 12:04・要確認')
    expect(dashboardFreshnessText('unavailable', null, 'fetch_failed')).toBe('取得失敗・外部サービスの取得に失敗')
    expect(dashboardFreshnessText('partial', '2026-09-13T03:04:00.000Z', 'source_failed', sameDay)).toBe('一部取得・更新 12:04・集計元の取得に失敗')
  })

  it('壊れた時刻をHH:MMへ誤変換しない', () => {
    expect(formatDashboardAsOf('not-a-date')).toBeNull()
  })

  it.each(['Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC'])(
    'timezone無しD1時刻は閲覧端末TZ=%sに依存せずJSTとして表示する',
    (timezone) => {
      const previous = process.env.TZ
      process.env.TZ = timezone
      try {
        expect(formatDashboardAsOf('2026-09-13 03:04:00', sameDay)).toBe('03:04')
        expect(formatDashboardAsOf('2026-09-13T03:04:00.123', sameDay)).toBe('03:04')
      } finally {
        process.env.TZ = previous
      }
    },
  )

  it('Z・offset付き時刻は指定された絶対時刻を維持する', () => {
    expect(formatDashboardAsOf('2026-09-13T03:04:00.000Z', sameDay)).toBe('12:04')
    expect(formatDashboardAsOf('2026-09-13T03:04:00+07:00', sameDay)).toBe('05:04')
  })

  it.each([
    ['fresh', 'text-ink-faint'],
    ['delayed', 'text-warning'],
    ['stale', 'text-warning'],
    ['partial', 'text-warning'],
    ['unavailable', 'text-danger'],
  ] as const)('%sの表示色を静的Tailwind classで維持する', (freshness, className) => {
    const html = renderToStaticMarkup(createElement(DashboardFreshness, {
      freshness,
      asOf: freshness === 'unavailable' ? null : '2026-09-13T03:04:00.000Z',
    }))
    expect(html).toContain(`class="${className} shrink-0 text-xs font-medium"`)
  })
})
