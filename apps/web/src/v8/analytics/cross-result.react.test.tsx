// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ audience: vi.fn(), push: vi.fn(), save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    friendFields: { ...actual.api.friendFields, list: async () => ({ success: true, data: [] }) },
    analytics: { ...actual.api.analytics,
      runCross: async () => ({ success: true, data: { id: 'result-1', state: 'pending' } }),
      crossResult: async () => ({ success: true, data: { id: 'result-1', state: 'available', result: {
        lineAccountId: 'account-1', timeZone: 'Asia/Tokyo', totalValue: 12, totalFriends: 12, previousTotalValue: 0,
        rowValues: [{ key: 'route-1', label: '広告' }], columnValues: [{ key: 'tag-1', label: '購入' }],
        cells: [{ rowKey: 'route-1', rowLabel: '広告', columnKey: 'tag-1', columnLabel: '購入', value: 12, uniqueFriends: 12, totalRatio: 1, previousValue: 0, difference: 12 }],
        periodFrom: '2026-10-01T00:00:00Z', periodTo: '2026-10-08T00:00:00Z',
        previousPeriodFrom: '2026-09-24T00:00:00Z', previousPeriodTo: '2026-10-01T00:00:00Z',
        dataCutoffAt: '2026-10-08T00:00:00Z', state: 'available', stateReason: null,
      } } }),
      createResultAudience: net.audience,
    },
  } }
})
import CrossV8 from './cross'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  sessionStorage.clear()
  net.audience.mockReset().mockResolvedValue({ success: true, data: { id: 'audience-1' } })
  net.push.mockReset()
  net.save.mockReset()
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('集計完了後も結果のIDを残し、保存と対象者づくりに同じ結果を渡す', async () => {
  render(<CrossV8 accountId="account-1" canManage renderSave={(props) => <button onClick={() => net.save(props)}>この分析を保存</button>} />)
  const run = await screen.findByRole('button', { name: '集計する' })
  await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false))
  fireEvent.click(run)
  fireEvent.click(await screen.findByRole('button', { name: 'この分析を保存' }))
  expect(net.save).toHaveBeenCalledWith(expect.objectContaining({ sourceResultId: 'result-1' }))
  expect(sessionStorage.getItem('lh:analytics:cross-run:v1:account-1')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '対象者を開く' }))
  await waitFor(() => expect(net.audience).toHaveBeenCalledWith('account-1', 'result-1', { sourceKind: 'cross', rowKey: 'route-1', columnKey: 'tag-1' }))
  expect(net.push).toHaveBeenCalledWith('/friends?audienceId=audience-1')
})
