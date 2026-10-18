// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EcSummary from './ec-summary'
import EcPeriodSummary from './ec-period'
import { dashboardCardForStyle } from './style-cards'
const net = vi.hoisted(() => ({ overview: vi.fn(), orders: vi.fn(), connector: vi.fn(), period: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: { ecCommerce: net }, fetchApi: net.period }))
beforeEach(() => {
  net.period.mockReset().mockResolvedValue({ success: true, data: { from: '2026-10-19T00:00:00+09:00', to: '2026-10-20T00:00:00+09:00', timeZone: 'Asia/Tokyo', asOf: null, status: 'unconfigured', orders: { value: null, status: 'unconfigured', formula: '注文日' }, repeatCustomers: { value: null, status: 'unconfigured', formula: '再購入' } } })
  net.overview.mockReset().mockResolvedValue({ success: true, data: { total: 1, subscriptions: 12, identityPending: 3 } })
  net.orders.mockReset().mockResolvedValue({ success: true, data: { total: 1, summary: { current: 21 } } })
  net.connector.mockReset().mockResolvedValue({ success: true, data: { configured: true } })
})
afterEach(cleanup)
it('標準ではECと専用の数字を出さず、ECの注文は既存の実データと同じアカウントを読む', async () => {
  expect(dashboardCardForStyle('shipment', 'standard')).toBe(false)
  expect(dashboardCardForStyle('today-shipments', 'standard')).toBe(false)
  expect(dashboardCardForStyle('today-photo-review', 'ec')).toBe(false)
  render(<EcSummary accountId="ec-account" />)
  await screen.findByText('21')
  expect(net.orders).toHaveBeenCalledWith({ lineAccountId: 'ec-account', limit: 1 })
  expect(screen.getByRole('link', { name: 'つき合わせを確認する' }).getAttribute('href')).toBe('/ec-commerce/identity-candidates')
})
it('未接続・失敗を0にせず、読み直しと別店の切替で古い数字を捨てる', async () => {
  net.overview.mockRejectedValueOnce(new Error('offline'))
  const view = render(<EcSummary accountId="a" />)
  await screen.findByText('ECの状況を読み込めませんでした')
  expect(screen.queryByText('21')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
  await screen.findByText('21')
  net.connector.mockResolvedValue({ success: true, data: { configured: false } })
  net.orders.mockResolvedValue({ success: true, data: { total: 0, summary: { current: 0 } } })
  net.overview.mockResolvedValue({ success: true, data: { total: 0, subscriptions: 0, identityPending: 0 } })
  view.rerender(<EcSummary accountId="b" />)
  expect(screen.queryByText('21')).toBeNull()
  await waitFor(() => expect(net.connector).toHaveBeenCalledWith('b'))
  expect(screen.queryByText('0')).toBeNull()
})

it('T01の接続済み・注文未取得を、未設定や0件と区別する', async () => {
  const response = await net.period()
  net.period.mockClear().mockResolvedValue({ ...response, data: { ...response.data, status: 'unavailable' } })
  render(<EcPeriodSummary accountId="ec-account" period="today" />)
  await screen.findByText('ECは接続済みですが、注文をまだ取り込めていません。数字を0件としては表示していません。')
  expect(screen.queryByText('0')).toBeNull()
  expect(screen.getAllByText('まだ取り込めていません')).toHaveLength(2)
})

it('T01の割合0〜1を%で表示し、選んだ期間と分母を渡して示す', async () => {
  const response = await net.period()
  net.period.mockClear().mockResolvedValue({ ...response, data: { ...response.data, status: 'available', orders: { value: 12, status: 'available', formula: '注文日' }, repeatCustomers: { value: .25, numerator: 3, denominator: 12, status: 'available', formula: '再購入' } } })
  render(<EcPeriodSummary accountId="ec-account" period="last7" />)
  await screen.findByText('25')
  const query = new URL(net.period.mock.calls[0][0], 'https://fixture.test').searchParams
  expect(query.get('account_id')).toBe('ec-account')
  expect(new Date(query.get('to')!).getTime() - new Date(query.get('from')!).getTime()).toBe(7 * 86400000)
})
