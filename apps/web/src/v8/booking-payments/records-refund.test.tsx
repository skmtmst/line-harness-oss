// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ records: vi.fn(), refund: vi.fn(), saved: vi.fn() }))
vi.mock('@/lib/api/helpers/booking-payment-admin', async (load) => {
  const actual = await load<typeof import('@/lib/api/helpers/booking-payment-admin')>()
  return { ...actual, bookingPaymentAdminApi: { ...actual.bookingPaymentAdminApi, ...net,
    connection: async () => ({ data: { connected: true, testMode: true } }),
  } }
})
vi.mock('@/components/shared/toast', () => ({ notifySaved: net.saved, notifyToast: vi.fn() }))

import PaymentRecords from './records'

function page(refundedAmount = 0) {
  return { success: true, data: {
    summary: { paidAmount: 1000, paidCount: 1, refundedAmount, refundedCount: refundedAmount ? 1 : 0,
      expiredCount: 0, pendingCount: 0, holdMinutes: 10 },
    total: 1, items: [{ id: 'payment-1', bookingId: 'booking-1', friendId: 'friend-1', friendName: '山田',
      bookingLabel: '相談', bookingNote: null, bookingStartsAt: null, amount: 1000,
      status: refundedAmount ? 'partially_refunded' : 'paid', method: 'online', createdAt: '2026-10-17T03:00:00Z',
      receiptUrl: null, refundedAmount, actorLabel: null, reason: null }],
  } }
}

beforeEach(() => {
  net.records.mockResolvedValue(page())
  net.refund.mockResolvedValue({ success: true, data: { simulation: true, sent: false } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

async function openRefund() {
  fireEvent.click(await screen.findByRole('button', { name: '山田の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '返金する' }))
  return screen.findByRole('dialog', { name: '返金する' })
}

async function confirm(amount?: number, notify = true) {
  const dialog = await openRefund()
  if (amount !== undefined) {
    fireEvent.click(within(dialog).getByRole('radio', { name: '一部を返金する' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: '返金する金額' }), { target: { value: String(amount) } })
  }
  fireEvent.change(within(dialog).getByRole('textbox', { name: /返金の理由/ }), { target: { value: '人数の変更' } })
  if (!notify) fireEvent.click(within(dialog).getByRole('checkbox', { name: 'LINE でお客さまに返金を知らせる' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '次へ' }))
  const confirmation = await screen.findByRole('alertdialog')
  fireEvent.click(within(confirmation).getByRole('button', { name: /を返金する$/ }))
}

it.each([undefined, 300])('全額/一部の金額・理由・通知の選択を新APIへ渡す (%s)', async (amount) => {
  render(<PaymentRecords accountId="account-1" canEdit />)
  await confirm(amount, false)
  await waitFor(() => expect(net.refund).toHaveBeenCalledTimes(1))
  expect(net.refund).toHaveBeenCalledWith('payment-1', {
    amount: amount ?? 1000, reason: '人数の変更', notifyLine: false, idempotencyKey: expect.any(String),
  })
  expect(net.refund.mock.calls[0][1].idempotencyKey.length).toBeGreaterThan(0)
  await waitFor(() => expect(net.saved).toHaveBeenCalledWith(expect.stringContaining('模擬')))
  expect(net.saved).toHaveBeenCalledWith(expect.stringContaining('実際の返金・LINE送信はしていません'))
  expect(net.records).toHaveBeenCalledTimes(2)
})

it('返事が失われた同じ操作の再試行では同じキーを使い、入力を残す', async () => {
  net.refund.mockRejectedValueOnce(new Error('network'))
  render(<PaymentRecords accountId="account-1" canEdit />)
  await confirm(300)
  await screen.findByText('返金できませんでした。Stripe の管理画面で状態を確かめてください。')
  expect(net.saved).not.toHaveBeenCalled()
  const first = net.refund.mock.calls[0][1]
  expect(first).toMatchObject({ amount: 300, reason: '人数の変更', notifyLine: true })
  const dialog = screen.getByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /を返金する$/ }))
  await waitFor(() => expect(net.refund).toHaveBeenCalledTimes(2))
  expect(net.refund.mock.calls[1]).toEqual(net.refund.mock.calls[0])
})

it('既に一部返金した支払いは残額だけを全額として扱う', async () => {
  net.records.mockResolvedValue(page(300))
  render(<PaymentRecords accountId="account-1" canEdit />)
  await confirm()
  await waitFor(() => expect(net.refund).toHaveBeenCalledTimes(1))
  expect(net.refund.mock.calls[0][1]).toMatchObject({ amount: 700 })
})

it('閲覧のみでは返金の入口を出さない', async () => {
  render(<PaymentRecords accountId="account-1" canEdit={false} />)
  fireEvent.click(await screen.findByRole('button', { name: '山田の操作' }))
  expect(screen.queryByRole('menuitem', { name: '返金する' })).toBeNull()
  expect(net.refund).not.toHaveBeenCalled()
})
