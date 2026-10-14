// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import KpiCard from './kpi-card'
afterEach(cleanup)

it('体重の範囲を状態札にせず、数と単位で読む', () => {
  const { container } = render(<KpiCard title="体重" value={null} valueRange={{ from: 9.2, to: 9.4 }} unit="kg" detail={null} />)
  expect(container.querySelector('[data-kpi-number]')?.textContent).toBe('9.2 → 9.4')
  expect(container.querySelector('[data-design-node="xRvDB"]')).toBeNull()
  expect(container.textContent).toContain('kg')
})
it('0の端点を残し、未取得の端点は0に変えない', () => {
  const { container, rerender } = render(<KpiCard title="範囲" value={null} valueRange={{ from: 0, to: 2 }} unit="件" detail={null} />)
  expect(container.querySelector('[data-kpi-number]')?.textContent).toBe('0 → 2')
  rerender(<KpiCard title="範囲" value={50} valueRange={{ from: null, to: 2 }} unit="件" detail={null} />)
  expect(container.querySelector('[data-kpi-number]')?.textContent).toBe('—')
  rerender(<KpiCard title="範囲" value={50} valueRange={{ from: 2, to: Infinity }} unit="件" detail={null} />)
  expect(container.querySelector('[data-kpi-number]')?.textContent).toBe('—')
})
it('指定しない状態と単独の数の出し方を保つ', () => {
  const { container, rerender } = render(<KpiCard title="接続" value={null} valueText="未接続" unit="" detail={null} />)
  expect(container.querySelector('[data-design-node="xRvDB"]')?.textContent).toBe('未接続')
  rerender(<KpiCard title="件数" value={1234} unit="件" detail={null} />)
  expect(container.querySelector('[data-kpi-number]')?.textContent).toBe('1,234')
})
