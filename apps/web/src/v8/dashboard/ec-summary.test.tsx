// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EcSummary from './ec-summary'
import EcPeriodSummary from './ec-period'
import { dashboardCardForStyle } from './style-cards'
const net = vi.hoisted(() => ({ overview: vi.fn(), orders: vi.fn(), shipments: vi.fn(), subscriptions: vi.fn(), connector: vi.fn(), period: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: { ecCommerce: net }, fetchApi: net.period }))
beforeEach(() => {
  net.period.mockReset().mockResolvedValue({ success: true, data: { from: '2026-10-19T00:00:00+09:00', to: '2026-10-20T00:00:00+09:00', timeZone: 'Asia/Tokyo', asOf: null, status: 'unconfigured', orders: { value: null, status: 'unconfigured', formula: '注文日' }, repeatCustomers: { value: null, status: 'unconfigured', formula: '再購入' } } })
  net.overview.mockReset().mockResolvedValue({ success: true, data: { total: 1, subscriptions: 12, identityPending: 3 } })
  net.orders.mockReset().mockResolvedValue({ success: true, data: { total: 21, summary: { current: 21 } } })
  net.shipments.mockReset().mockResolvedValue({ success: true, data: { today: '2026-10-28', tomorrow: '2026-10-29', todayCount: 4, soonCount: 7, scanned: 7, scanLimit: 200, soon: [], later: [] } })
  net.subscriptions.mockReset().mockResolvedValue({ success: true, data: { items: [{ nextShippingAt: '2026-11-05' }], summary: { active: 12 }, skipped: { malformedSnapshots: 0 }, risk: { calculatedAt: '2026-10-28T01:00:00Z' } } })
  net.connector.mockReset().mockResolvedValue({ success: true, data: { configured: true, health: { lastSucceededAt: '2026-10-28T01:00:00.000Z' } } })
})
afterEach(cleanup)
it('標準ではECと専用の数字を出さず、ECの注文は既存の実データと同じアカウントを読む', async () => {
  expect(dashboardCardForStyle('shipment', 'standard')).toBe(false)
  expect(dashboardCardForStyle('today-shipments', 'standard')).toBe(false)
  expect(dashboardCardForStyle('today-photo-review', 'ec')).toBe(false)
  for (const id of ['today-bookings', 'booking-status', 'today-shipments'] as const) {
    expect(dashboardCardForStyle(id, 'ec', true)).toBe(false)
  }
  expect(dashboardCardForStyle('upcoming', 'ec', true)).toBe(true)
  render(<EcSummary accountId="ec-account" />)
  await screen.findByText('21')
  expect(net.orders).toHaveBeenCalledWith(expect.objectContaining({ lineAccountId: 'ec-account', status: 'current', limit: 1 }))
  expect(Number.isFinite(Date.parse(net.orders.mock.calls[0][0].from))).toBe(true)
  expect(new Date(net.orders.mock.calls[0][0].to).getTime() - new Date(net.orders.mock.calls[0][0].from).getTime()).toBe(24 * 60 * 60 * 1000)
  expect(net.shipments).toHaveBeenCalledWith({ accountId: 'ec-account', limit: 1 })
  expect(net.subscriptions).toHaveBeenCalledWith({ lineAccountId: 'ec-account', status: 'active', limit: 1 })
  expect(screen.getByText('今日の注文')).toBeTruthy()
  expect(screen.getByText('出荷予定')).toBeTruthy()
  expect(screen.getByText('定期便の次回')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'つき合わせを確認する' }).getAttribute('href')).toBe('/ec-commerce/identity-candidates')
})
it('未接続・失敗を0にせず、読み直しと別店の切替で古い数字を捨てる', async () => {
  net.overview.mockRejectedValueOnce(new Error('offline'))
  const view = render(<EcSummary accountId="a" />)
  await screen.findByText('つき合わせ待ちを読み込めませんでした')
  expect(screen.getByText('21')).toBeTruthy()
  expect(screen.queryByText('3')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
  await screen.findByText('21')
  net.subscriptions.mockResolvedValue({ success: true, data: { items: [], summary: { active: 0 }, skipped: { malformedSnapshots: 0 }, risk: { calculatedAt: null } } })
  net.connector.mockResolvedValue({ success: true, data: { configured: false } })
  net.orders.mockResolvedValue({ success: true, data: { total: 0, summary: { current: 0 } } })
  net.overview.mockResolvedValue({ success: true, data: { total: 0, subscriptions: 0, identityPending: 0 } })
  net.shipments.mockResolvedValue({ success: true, data: { today: '2026-10-28', tomorrow: '2026-10-29', todayCount: 0, soonCount: 0, scanned: 0, scanLimit: 200, soon: [], later: [] } })
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

it('予約・スタンプの代わりに実注文、出荷予定、次回発送日を表示する', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T14:59:59.000Z'))
  try {
    render(<EcSummary accountId="real" />)
    await screen.findByText('21')
    expect(net.orders).toHaveBeenCalledWith({ lineAccountId: 'real', status: 'current', from: '2026-10-27T15:00:00.000Z', to: '2026-10-28T15:00:00.000Z', limit: 1 })
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText(/11月5日/)).toBeTruthy()
    expect(screen.queryByText('今日の予約')).toBeNull()
    expect(screen.queryByText(/来店スタンプ/)).toBeNull()
  } finally { vi.useRealTimers() }
})

it('出荷の取得上限と次回発送日の欠測を0や日付で埋めない', async () => {
  net.shipments.mockResolvedValue({ success: true, data: { soonCount: 200, scanned: 200, scanLimit: 200 } })
  net.subscriptions.mockResolvedValue({ success: true, data: { items: [{ nextShippingAt: null }], summary: { active: 1 }, skipped: { malformedSnapshots: 0 }, risk: { calculatedAt: '2026-10-28' } } })
  render(<EcSummary accountId="real" />)
  await screen.findByText('21')
  expect(screen.queryByText('200')).toBeNull()
  expect(screen.getByText('取得上限または欠測で全件を確認できません')).toBeTruthy()
  expect(screen.queryByText('なし')).toBeNull()
})

it('同期済みなら全期間の注文0でも今日は0、同期済みで契約なしなら「なし」を出す', async () => {
  net.orders.mockResolvedValue({ success: true, data: { total: 0, summary: { current: 0 } } })
  net.subscriptions.mockResolvedValue({ success: true, data: { items: [], summary: { active: 0 }, skipped: { malformedSnapshots: 0 }, risk: { calculatedAt: '2026-10-28' } } })
  render(<EcSummary accountId="real" />)
  await screen.findByText('なし')
  expect(screen.getByText('0')).toBeTruthy()
})


it.each([null, 'invalid'])('注文の同期時刻が%sなら0件でなく未同期と示す', async (lastSucceededAt) => {
  net.orders.mockResolvedValue({ success: true, data: { total: 0, summary: { current: 0 } } })
  net.connector.mockResolvedValue({ success: true, data: { configured: true, health: { lastSucceededAt } } })
  render(<EcSummary accountId="real" />)
  await screen.findByText('まだ注文を取り込んでいません')
  expect(screen.queryByText('0')).toBeNull()
  expect(screen.getByText('7')).toBeTruthy()
})

it('注文の一部失敗や不正な合計を0件にせず、読めた出荷予定を保持する', async () => {
  net.orders.mockRejectedValueOnce(new Error('orders offline'))
  const view = render(<EcSummary accountId="real" />)
  await screen.findByText('今日の注文を読み込めませんでした')
  expect(screen.queryByText('21')).toBeNull()
  expect(screen.getByText('7')).toBeTruthy()
  net.orders.mockResolvedValue({ success: true, data: { total: 'invalid', summary: { current: 0 } } })
  view.rerender(<EcSummary accountId="other" />)
  await waitFor(() => expect(net.orders).toHaveBeenCalledWith(expect.objectContaining({ lineAccountId: 'other' })))
  expect(screen.queryByText('0')).toBeNull()
})

it('部分失敗は数の上の1本の知らせにして、定義と重複の接続操作を出さない', async () => {
  net.orders.mockRejectedValueOnce(new Error('orders offline'))
  const { container } = render(<EcSummary accountId="real" />)
  const message = await screen.findByText('今日の注文を読み込めませんでした')
  expect(message.closest('[data-design-part="notice"]')?.textContent).toMatch(/要確認：/)
  expect(container.querySelectorAll('[data-design-part="notice"]')).toHaveLength(1)
  expect(screen.getByText('7')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'ECの状況を読み込めませんでした' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'ECの接続を確認する' })).toBeNull()
  expect(screen.queryByText(/自動のLINEの設定と模擬確認は/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ECの状況の説明' }))
  expect(screen.getByText(/自動のLINEの設定と模擬確認は/)).toBeTruthy()
})

it('全て読めなかった時だけ大きな失敗表示で再取得できる', async () => {
  for (const fn of [net.overview, net.orders, net.shipments, net.subscriptions, net.connector]) fn.mockRejectedValue(new Error('offline'))
  const { container } = render(<EcSummary accountId="real" />)
  await screen.findByText('ECの状況を読み込めませんでした')
  expect(screen.getByRole('button', { name: /もう一度読み込む/ })).toBeTruthy()
  expect(container.querySelectorAll('[data-design-part="notice"]')).toHaveLength(0)
  expect(screen.queryByText('0')).toBeNull()
})
