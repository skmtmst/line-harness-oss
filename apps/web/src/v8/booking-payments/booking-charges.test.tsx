// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const requests = vi.hoisted(() => ({ charges: vi.fn(), card: vi.fn(), charge: vi.fn() }))
vi.mock('@/lib/api/helpers/gap1', () => ({ bookingCancellationApi: requests }))
vi.mock('@/lib/api/helpers/booking-advanced', () => ({ bookingAdvancedApi: { card: requests.card } }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
import { BookingChargesSection } from './booking-charges'
const props = { accountId: 'a', bookingId: 'b', customerName: '確認用', bookingLabel: '予約', price: 1000, canCharge: true, canRefund: true }
const data = (testMode: boolean) => ({ success: true, data: { testMode, charges: [{ id: 'charge', kind: 'no_show_fee', status: 'pending', amount: 1000, version: 2, reason: null }], quote: { text: '確認用の決まり' } } })
beforeEach(() => {
  Object.values(requests).forEach((request) => request.mockReset())
  requests.charges.mockResolvedValue(data(true))
  requests.card.mockResolvedValue({ success: true, data: { brand: 'VISA', last4: '4242', registeredAt: null } })
})
afterEach(cleanup)

it('カード取得失敗を未登録にせず、その場の再取得だけで復旧する', async () => {
  requests.card.mockRejectedValueOnce(new Error('offline'))
  render(<BookingChargesSection {...props} />)
  await screen.findByText('カード情報を読み込めませんでした')
  expect(screen.queryByText('カード：未登録')).toBeNull()
  expect((screen.getByRole('button', { name: 'キャンセル料を請求する' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await screen.findByText(/VISA •••• 4242/)
  expect(requests.charges).toHaveBeenCalledTimes(1)
  expect(requests.charge).not.toHaveBeenCalled()
})

it('試験でない請求は共通の準備中を出し、請求の口を呼ばない', async () => {
  requests.charges.mockResolvedValue(data(false))
  render(<BookingChargesSection {...props} />)
  await screen.findByText(/VISA •••• 4242/)
  await waitFor(() => expect((screen.getByRole('button', { name: 'キャンセル料を請求する' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル料を請求する' }))
  await screen.findByRole('dialog', { name: '現在準備中です' })
  expect(screen.queryByRole('dialog', { name: 'キャンセル料を請求しますか？' })).toBeNull()
  expect(requests.charge).not.toHaveBeenCalled()
})
