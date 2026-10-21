// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ audience: vi.fn(), push: vi.fn(), save: vi.fn(), run: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    friendFields: { ...actual.api.friendFields, list: async () => ({ success: true, data: [] }) },
    analytics: { ...actual.api.analytics,
      runCross: net.run,
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
import { flushListUrlState } from '@/components/shared/list-url-state'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  sessionStorage.clear()
  net.audience.mockReset().mockResolvedValue({ success: true, data: { id: 'audience-1' } })
  net.push.mockReset()
  net.save.mockReset()
  net.run.mockReset().mockResolvedValue({ success: true, data: { id: 'result-1', state: 'pending' } })
  flushListUrlState()
  window.history.replaceState(null, '', '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T03:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers(); delete document.documentElement.dataset.theme })

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

it('共通ツールバーでも指定した2日付と軸を集計へ渡し、結果を同じIDで保存する', async () => {
  const view = render(<CrossV8 accountId="account-1" canManage renderSave={(props) => <button onClick={() => net.save(props)}>この分析を保存</button>} />)
  await screen.findByRole('button', { name: '過去7日' })
  expect(view.container.querySelector('[data-list-toolbar]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '過去7日' }))
  fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
  fireEvent.click(screen.getByRole('button', { name: '期間の始まり' }))
  fireEvent.click(screen.getByRole('button', { name: /2026年10月14日/ }))
  fireEvent.click(screen.getByRole('button', { name: '期間の終わり' }))
  fireEvent.click(screen.getByRole('button', { name: /2026年10月15日/ }))
  const run = screen.getByRole('button', { name: '集計する' })
  await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false))
  fireEvent.click(run)
  expect(net.run).toHaveBeenCalledWith('account-1', expect.objectContaining({ periodFrom: '2026-10-14T00:00:00+09:00', periodTo: '2026-10-15T14:59:59.999Z', rowAxis: { kind: 'tag' }, columnAxis: { kind: 'route' } }))
  fireEvent.click(await screen.findByRole('button', { name: 'この分析を保存' }))
  expect(net.save).toHaveBeenCalledWith(expect.objectContaining({ sourceResultId: 'result-1' }))
  expect(screen.getByRole('button', { name: '期間を指定' }).getAttribute('aria-pressed')).toBe('true')
})

it('閲覧者の期間操作は残し、分析保存は表示しない', async () => {
  render(<CrossV8 accountId="account-1" canManage={false} renderSave={() => <button>この分析を保存</button>} />)
  fireEvent.click(await screen.findByRole('button', { name: '過去7日' }))
  expect(screen.getByRole('button', { name: '過去7日' }).getAttribute('aria-pressed')).toBe('true')
  const run = screen.getByRole('button', { name: '集計する' })
  await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false))
  fireEvent.click(run)
  await waitFor(() => expect(screen.getByText(/^集計できました/)).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'この分析を保存' })).toBeNull()
  expect(screen.queryByRole('button', { name: '対象者を開く' })).toBeNull()
})
