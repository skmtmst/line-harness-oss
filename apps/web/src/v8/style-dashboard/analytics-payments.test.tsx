// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndustryStyle, StyleDashboardPayments, StyleSnapshot } from '@line-crm/shared'
import { toAnalytics } from './adapter'
import { StyleAnalyticsView } from './analytics'

const period = { from: '2026-09-15T15:00:00Z', to: '2026-10-15T15:00:00Z', timeZone: 'Asia/Tokyo', dateBasis: 'payment' as const }
const payment: StyleDashboardPayments = { status: 'available', paidAmount: 12345, paidCount: 3, refundedAmount: 1200, refundedCount: 1, pendingCount: 2, expiredCount: 4, holdMinutes: 30, source: '/api/booking/admin/payments', period }
function snapshot(payments: StyleDashboardPayments | undefined = payment): StyleSnapshot & { analytics: Record<string, unknown> } {
  return { style: 'restaurant', asOf: '2026-10-21T03:00:00Z', ...period, dateBasis: 'visit', range: 'month',
    metrics: { bookings: { value: 17, status: 'available', unit: '件', formula: '取消を除く予約' } }, previous: {}, items: [], newBookings: [], resultId: 'fixture', payments,
    analytics: { daily: [{ date: '2026-10-15', bookings: 17, visits: 13 }], menus: [{ menuId: 'course', bookings: 17, visits: 13, cancellations: 2 }] } }
}
function show(payments: StyleDashboardPayments | undefined = payment, error = false) {
  const onRetry = vi.fn()
  render(<StyleAnalyticsView data={toAnalytics('restaurant', snapshot(payments), 'payments', {})} error={error} onTab={() => {}} onRetry={onRetry} onRowOpen={() => {}} />)
  return onRetry
}
afterEach(cleanup)

describe('支払いの分析', () => {
  it('小タブで入金へ切り替えると予約のグラフとコース表を使わず、予約へ戻すと元の内容を保つ', () => {
    function Analysis() {
      const [tab, setTab] = useState('reservations')
      return <StyleAnalyticsView data={toAnalytics('restaurant', snapshot(), tab, { course: '夕食コース' })} error={false} onTab={setTab} onRetry={() => {}} onRowOpen={() => {}} />
    }
    render(<Analysis />)
    expect(screen.getByRole('img', { name: '日ごとの予約（来店日で数える）のグラフ' })).toBeTruthy()
    expect(screen.getByText('夕食コース')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'お支払い' }))
    expect(screen.getByRole('button', { name: 'お支払い' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByLabelText('入金額')).getByText('¥12,345')).toBeTruthy()
    expect(within(screen.getByLabelText('返金額')).getByText('¥1,200')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('夕食コース')).toBeNull()
    expect(screen.getByText(/日別の支払いグラフは/)).toBeTruthy()
    expect(screen.getByText(/期間内の支払い明細は/)).toBeTruthy()
    expect(screen.getByText(/Asia\/Tokyo/).textContent).toBe('9月16日（水）〜10月15日（木）（Asia/Tokyo）。')
    fireEvent.click(screen.getByRole('button', { name: '予約', exact: true }))
    expect(screen.getByRole('img', { name: '日ごとの予約（来店日で数える）のグラフ' })).toBeTruthy()
    expect(screen.getByText('夕食コース')).toBeTruthy()
    expect(within(screen.getByLabelText('予約数')).getByText('17')).toBeTruthy()
  })

  it.each<IndustryStyle>(['restaurant', 'salon', 'consult', 'lesson'])('%sも同じ期間の支払い値だけを表示する', (style) => {
    const data = toAnalytics(style, snapshot(), 'payments', {})
    expect(data.cards.map(c => [c.id, c.valueText])).toEqual([['paidAmount', '¥12,345'], ['paidCount', '3'], ['refundedAmount', '¥1,200'], ['refundedCount', '1'], ['pendingCount', '2'], ['expiredCount', '4']])
    expect(data.chart).toBeNull()
    expect(data.table).toBeNull()
  })

  it('取得済みの0件は0と表示するが、欠けた個別値は未取得と表示する', () => {
    const zero = { ...payment, paidAmount: 0, paidCount: 0, refundedAmount: 0, refundedCount: 0, pendingCount: 0, expiredCount: 0 }
    show(zero)
    expect(within(screen.getByLabelText('入金額')).getByText('¥0')).toBeTruthy()
    expect(within(screen.getByLabelText('入金件数')).getByText('0')).toBeTruthy()
    cleanup()
    const incomplete = { ...zero, refundedAmount: undefined } as unknown as StyleDashboardPayments
    show(incomplete)
    expect(within(screen.getByLabelText('返金額')).getByText('—')).toBeTruthy()
    expect(within(screen.getByLabelText('返金額')).queryByText('¥0')).toBeNull()
  })

  it.each([
    ['missing', undefined, '選択した期間の支払い集計はまだ取得できていません。0件としては扱いません。'],
    ['unavailable', { status: 'unavailable' } as const, 'このアカウントの支払い集計は利用できません。0件としては扱いません。'],
    ['forbidden', { status: 'forbidden' } as const, '支払いの記録を表示する権限がありません。'],
    ['today-only', { ...payment, period: undefined }, '選択した期間の支払い集計はまだ取得できていません。0件としては扱いません。'],
    ['other-period', { ...payment, period: { ...period, from: '2026-10-01T00:00:00Z' } }, '選択した期間の支払い集計はまだ取得できていません。0件としては扱いません。'],
    ['other-zone', { ...payment, period: { ...period, timeZone: 'UTC' } }, '選択した期間の支払い集計はまだ取得できていません。0件としては扱いません。'],
  ])('%sでは0件や予約値で埋めず、切り替え入口を保つ', (_name, payments, message) => {
    const data = toAnalytics('restaurant', { ...snapshot(), payments }, 'payments', {})
    render(<StyleAnalyticsView data={data} error={false} onTab={() => {}} onRetry={() => {}} onRowOpen={() => {}} />)
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.getByRole('button', { name: '予約', exact: true })).toBeTruthy()
    expect(screen.queryByLabelText('入金額')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('集計の読取失敗は再試行でき、古い入金額を表示しない', () => {
    const retry = show(payment, true)
    expect(screen.getByText('分析を読み込めませんでした')).toBeTruthy()
    expect(screen.queryByLabelText('入金額')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
