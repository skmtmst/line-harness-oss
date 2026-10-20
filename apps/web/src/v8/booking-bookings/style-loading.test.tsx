// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BookingLedgerScreen from '@/app/booking/bookings/ledger-screen'
import type { BookingLedgerModel } from '../../app/booking/bookings/use-booking-ledger'
afterEach(cleanup)

it('業種を未取得・取得失敗の間は、前の来店語や操作を出さず読み直す', () => {
  const reload = vi.fn()
  const model = { selectedAccountId: 'new-account', view: 'list', styleProfile: { data: null, error: null, reload } }
  const view = render(<BookingLedgerScreen model={model as unknown as BookingLedgerModel} />)
  expect(screen.getByLabelText('使い方のスタイルを確認しています')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '来店した' })).toBeNull()
  view.rerender(<BookingLedgerScreen model={{ ...model, styleProfile: { ...model.styleProfile, error: new Error('offline') } } as unknown as BookingLedgerModel} />)
  expect(screen.getByText('使い方のスタイルを読み込めませんでした')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
  expect(reload).toHaveBeenCalledOnce()
})
