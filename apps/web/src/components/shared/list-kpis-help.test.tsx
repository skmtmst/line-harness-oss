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
 * 数の帯の題の「？」（I1E7Bt の絵：マスごとに ?）。
 * KpiSpec.help を渡すと KpiCard の help へ届き「？」が出る。
 * 渡さなければ出ない（今までどおり）。
 */
describe('一覧KPIの「？」', () => {
  it('help を渡すと「？」が出る', async () => {
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
