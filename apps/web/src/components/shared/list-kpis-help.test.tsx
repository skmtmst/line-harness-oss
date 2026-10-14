// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: {
    listStats: {
      get: vi.fn(async () => ({ success: true, data: {} })),
    },
  },
}))

import ListKpis from './list-kpis'

afterEach(() => {
  cleanup()
})

/**
 * 説明を渡した題から読める。印を出すときは明示指定する。
 */
describe('一覧KPIの「？」', () => {
  it('help を渡すと、？を増やさず題から説明が読める', async () => {
    render(
      <ListKpis
        build={() => [
          { title: '有効な友だち', value: 1, unit: '人', detail: '', help: '数え方' },
          { title: 'b', value: 2, unit: '人', detail: '' },
          { title: 'c', value: 3, unit: '人', detail: '' },
          { title: 'd', value: 4, unit: '人', detail: '' },
        ]}
      />,
    )
    expect(await screen.findByText('有効な友だち')).toBeTruthy()
    expect(screen.getByRole('button', { name: '有効な友だちの説明' })).toBeTruthy()
    expect(screen.getByText('有効な友だち').closest('[data-kpi-label]')?.textContent).toBe('有効な友だち')
  })

  it('help を渡さなければ「？」は出ない', async () => {
    render(
      <ListKpis
        build={() => [
          { title: '有効な友だち', value: 1, unit: '人', detail: '' },
          { title: 'b', value: 2, unit: '人', detail: '' },
          { title: 'c', value: 3, unit: '人', detail: '' },
          { title: 'd', value: 4, unit: '人', detail: '' },
        ]}
      />,
    )
    expect(await screen.findByText('有効な友だち')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '有効な友だちの説明' })).toBeNull()
  })
})
