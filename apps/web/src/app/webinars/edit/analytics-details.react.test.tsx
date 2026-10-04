// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AnalyticsDetails from './analytics-details'
import type { WebinarAnalytics } from '@/lib/api'

const ANALYTICS = {
  sessions: [{ sessionStartAt: 1791457200, viewers: 40, avgWatchedSeconds: 330, ctaClicks: 8 }],
  daily: [{ date: '2026-10-08', reservations: 52, viewers: 40, ctaClicks: 8, formSubmissions: 3 }],
  formFunnel: { ctaImpressions: 20, ctaClicks: 8, formOpens: 6, formStarts: 5, submitAttempts: 4, submitSuccesses: 3, submitErrors: 1, fieldCompletions: [{ fieldName: '相談内容', users: 5 }] },
} as WebinarAnalytics

function render(analytics = ANALYTICS) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<AnalyticsDetails analytics={analytics} />)
  return host
}

describe('分析の詳細の数字を保つ', () => {
  it('回別の実数・平均視聴時間・参加者を分母にしたCTA率と日別の数を表示する', () => {
    const host = render()
    const tables = host.querySelectorAll('table')
    expect(tables[0].textContent).toContain('40人')
    expect(tables[0].textContent).toContain('5:30')
    expect(tables[0].textContent).toContain('8人（20%）')
    expect(tables[1].textContent).toContain('2026-10-08')
    expect(tables[1].textContent).toContain('52')
    expect(host.textContent).toContain('相談内容')
    expect(host.querySelector('dl')?.textContent).toContain('送信できた3人')
    expect(host.querySelector('details')?.open).toBe(false)
  })

  it('参加者ゼロの回は率を推測せず、フォーム集計がない時は未取得として示す', () => {
    const host = render({ ...ANALYTICS, sessions: [{ ...ANALYTICS.sessions[0], viewers: 0 }], formFunnel: undefined } as unknown as WebinarAnalytics)
    expect(host.querySelector('table')?.textContent).toContain('8人（—）')
    expect(host.textContent).toContain('フォームの集計を取得できていません')
    expect(host.querySelector('dl')).toBeNull()
  })

  it('データが空のときは回別・日別の表を作らない', () => {
    const host = render({ ...ANALYTICS, sessions: [], daily: [] })
    expect(host.textContent).toContain('まだ開催回の視聴データがありません')
    expect(host.textContent).toContain('まだ日別のデータがありません')
  })
})
