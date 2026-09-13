import { describe, expect, it } from 'vitest'

import { dashboardFreshnessText, formatDashboardAsOf } from './freshness'

describe('ダッシュボードの更新時刻と鮮度表示(#759)', () => {
  it('取得元の時刻を日本時間の「更新 HH:MM」で表示する', () => {
    expect(formatDashboardAsOf('2026-09-13T03:04:00.000Z')).toBe('12:04')
    expect(dashboardFreshnessText('fresh', '2026-09-13T03:04:00.000Z')).toBe('更新 12:04')
  })

  it('stale・取得失敗・部分取得を同じ表示にしない', () => {
    expect(dashboardFreshnessText('stale', '2026-09-13T03:04:00.000Z')).toBe('最終更新 12:04・要確認')
    expect(dashboardFreshnessText('unavailable', null, 'fetch_failed')).toBe('取得失敗・外部サービスの取得に失敗')
    expect(dashboardFreshnessText('partial', '2026-09-13T03:04:00.000Z', 'source_failed')).toBe('一部取得・更新 12:04・集計元の取得に失敗')
  })

  it('壊れた時刻をHH:MMへ誤変換しない', () => {
    expect(formatDashboardAsOf('not-a-date')).toBeNull()
  })
})
