// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ mode: 'customer_choice' as string | null, save: vi.fn() }))
vi.mock('@/lib/api', async (load) => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi,
    getPaymentConfig: async () => ({ success: true, data: { mode: 'onsite', provider: 'stripe', holdMinutes: 10, keyConfigured: true, testMode: true } }),
    saveMenuPayment: (...args: unknown[]) => net.save(...args),
  } }
})
vi.mock('@/lib/api/helpers/booking-payment-admin', async (load) => {
  const actual = await load<typeof import('@/lib/api/helpers/booking-payment-admin')>()
  return { ...actual, bookingPaymentAdminApi: { ...actual.bookingPaymentAdminApi,
    connection: async () => ({ success: true, data: { connected: true, testMode: true } }),
    menuOverrides: async () => ({ success: true, data: { menus: [{ menuId: 'm1', mode: net.mode }] } }),
  } }
})
vi.mock('@/lib/api/helpers/booking-advanced', () => ({ bookingAdvancedApi: {
  menuDeposit: async () => ({ data: { kind: 'none', value: null, inherit: true, conditions: { always: true, minPeople: null, weekdays: null, timeBand: null }, version: 1 } }),
} }))
const { BookingMenuPaymentCard, useMenuDeposit } = await import('./menu-deposit')
const { useMenuPayment } = await import('./menu-payment')
function Form({ readOnly = false }: { readOnly?: boolean }) {
  const payment = useMenuPayment('booking', 'a', 'm1')
  const deposit = useMenuDeposit('a', 'm1')
  return <><BookingMenuPaymentCard payment={payment} deposit={deposit} price={8800} readOnly={readOnly} /><button onClick={() => void payment.save()}>保存する</button></>
}
beforeEach(() => { net.mode = 'customer_choice'; net.save.mockReset().mockResolvedValue({ success: true }) })
afterEach(cleanup)

it('お客さまが選ぶ設定を読み戻せ、閲覧でも店頭払いと取り違えない', async () => {
  const view = render(<Form />)
  const choice = await screen.findByRole('checkbox', { name: /お客さまが選ぶ/ }) as HTMLInputElement
  expect(choice.checked).toBe(true)
  expect((screen.getByRole('radio', { name: /いつもの方法/ }) as HTMLInputElement).checked).toBe(false)
  view.rerender(<Form readOnly />)
  expect(await screen.findByText('お客さまが選ぶ')).toBeTruthy()
})

it('デポジットの選択と共存し、先払いか店頭払いをお客さまが選べる設定も保存できる', async () => {
  net.mode = null
  render(<Form />)
  fireEvent.click(await screen.findByRole('radio', { name: /お店で払う/ }))
  const choice = await screen.findByRole('checkbox', { name: /お客さまが選ぶ/ }) as HTMLInputElement
  fireEvent.click(choice)
  expect(choice.checked).toBe(true)
  expect(screen.getByRole('radio', { name: /デポジット/ })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  await waitFor(() => expect(net.save).toHaveBeenCalledWith('a', 'm1', { mode: 'customer_choice', provider: 'stripe' }))
})
