// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import KpiCard from './kpi-card'

afterEach(cleanup)

const label = '会員向けのおすすめ商品と今月のお知らせを見る'

test('明示した名前を主に表示し、全文と補足の回数を読める', () => {
  const view = render(<KpiCard title="いちばん押された" primaryText={label}
    value={12} unit="回" valueText="公開中" detail="通常メニュー・12 回" />)
  const primary = view.container.querySelector('[data-kpi-text-value]')
  expect(primary?.textContent).toBe(label)
  expect(primary?.getAttribute('title')).toBe(label)
  expect(view.container.querySelector('[data-kpi-number]')).toBeNull()
  expect(view.container.querySelector('[data-kpi-unit]')).toBeNull()
  expect(view.container.textContent).not.toContain('公開中')
  expect(view.getByText('通常メニュー・12 回')).toBeTruthy()
})

test('名前を読込中は表示せず、完了後は値からの既存操作を使える', () => {
  const onClick = vi.fn()
  const props = { title: '名前', primaryText: label, value: 0, unit: '件', detail: '',
    valueAction: { label: '内訳を見る', expanded: false, onClick } }
  const view = render(<KpiCard {...props} loading />)
  expect(view.container.querySelector('[data-kpi-skeleton]')).toBeTruthy()
  expect(view.container.querySelector('[data-kpi-text-value]')).toBeNull()
  view.rerender(<KpiCard {...props} />)
  expect(view.container.querySelector('[data-kpi-zero]')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '内訳を見る' }))
  expect(onClick).toHaveBeenCalledTimes(1)
})
