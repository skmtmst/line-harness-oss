// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import ScenarioResultSummary from './result-summary'
afterEach(cleanup)
const stats = { enrolledTotal: 1, activeNow: 1, completed: 1, paused: 1, steps: [] }
const metric = (name: string) => screen.getByText(name, { selector: '[data-kpi-label] span' }).closest('[data-kpi-presentation]')!
test('購読の集計が無いときは状態別の人数を合算せず、途中と離脱を未取得にする', () => {
  render(<ScenarioResultSummary stats={stats} />)
  expect(metric('読み終えた').textContent).toContain('1人')
  expect(metric('途中').querySelector('[data-kpi-number]')?.textContent).toBe('—')
  expect(metric('離れた').querySelector('[data-kpi-number]')?.textContent).toBe('—')
})
test('取得した0件と、算出できない離脱人数を混同しない', () => {
  render(<ScenarioResultSummary stats={stats} summary={{ active: 0, paused: 0, completed: 0, delivering: 0 }} />)
  expect(metric('読み終えた').querySelector('[data-kpi-number]')?.textContent).toBe('0')
  expect(metric('途中').querySelector('[data-kpi-number]')?.textContent).toBe('0')
  expect(metric('離れた').querySelector('[data-kpi-number]')?.textContent).toBe('—')
})
