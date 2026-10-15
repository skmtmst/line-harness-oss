// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { OpsSupportSummary } from '@/lib/api'
import OpsSupportStats from './support-stats'

afterEach(cleanup)

it('状態別の0を表示し、全期間の解決件数を今月の件数に代用しない', () => {
  const summary: OpsSupportSummary = {
    byStage: { all: 109, new: 0, in_progress: 7, waiting: 2, resolved: 100, closed: 0 },
    kpis: { untouched: 0, untouchedFromLine: 0, avgFirstReplyMinutes: null, prevAvgFirstReplyMinutes: null, resolutionRate: null, prevResolutionRate: null, avgResolutionMinutes: null, prevAvgResolutionMinutes: null },
  }
  const { container } = render(<OpsSupportStats summary={summary} loading={false} />)
  expect([...container.querySelectorAll('[data-kpi-number]')].map(el => el.textContent)).toEqual(['0', '7', '2', '100'])
  expect(container.textContent).not.toContain('今月の解決')
})

it('集計を取得できない時は0件と決めつけない', () => {
  const { container } = render(<OpsSupportStats summary={null} loading={false} />)
  expect([...container.querySelectorAll('[data-kpi-number]')].map(el => el.textContent)).toEqual(['—', '—', '—', '—'])
})
