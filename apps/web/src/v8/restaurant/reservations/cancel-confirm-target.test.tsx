// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'
import { CancelReservationDialog } from './dialogs'

afterEach(cleanup)
it('予約取消の確認にLINEアカウントと予約の店舗と環境を示す', () => {
  const reservation = { id: 'reservation-a', store_id: 'store-a', store_name: '予約した本店', starts_at: '2026-11-04T03:00:00Z', customer_name: 'テスト', guest_count: 2, status: 'confirmed' } as RestaurantReservation
  render(<CancelReservationDialog reservation={reservation} accountId="account-a" busy={false} onClose={vi.fn()} onConfirm={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'この予約を取り消しますか？' })
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('予約した本店')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})
