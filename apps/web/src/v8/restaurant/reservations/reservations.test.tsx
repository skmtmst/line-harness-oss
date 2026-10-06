// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), reservationsDay: vi.fn(), updateReservation: vi.fn(), createReservation: vi.fn(), holdReservation: vi.fn(),
  importReservation: vi.fn(), openingHours: vi.fn(), customerSearch: vi.fn(), customerHistory: vi.fn(),
}))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), usePathname: () => '/restaurant-test/reservations', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))

import ReservationsPage from './reservations'
import { at, reservation, snapshotOf } from '../booking-kit/test-data'

/* 今日：佐藤（LINE・T1）・山田（食べログ・承認待ち・T3・乳）・押さえ（T4）。 */
const today = [
  reservation('r1', { customer_name: '佐藤 健', source: 'line', starts_at: at(0, 18), ends_at: at(0, 20), table_id: 't1' }),
  reservation('r2', { customer_name: '山田 太郎', source: 'tabelog', status: 'pending', allergy_note: '乳', guest_count: 4, starts_at: at(0, 18, 30), ends_at: at(0, 20, 30), table_id: 't3', course_name: 'おまかせコース' }),
  reservation('r3', { customer_name: '押さえ', source: 'phone', status: 'pending', hold_expires_at: at(0, 23), note: '電話のお客さま用', guest_count: 4, starts_at: at(0, 20), ends_at: at(0, 21, 30), table_id: 't4' }),
]

beforeEach(() => {
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ success: true, data: snapshotOf({ reservations: today, reservationTotal: 3 }) })
  fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: today } })
  fixture.openingHours.mockResolvedValue({ data: { storeId: 'store-1', hours: null, version: 1, updatedBy: null, updatedAt: null } })
  for (const fn of [fixture.updateReservation, fixture.importReservation]) fn.mockResolvedValue({ success: true })
  fixture.createReservation.mockResolvedValue({ success: true, data: { id: 'new', tableId: 't2', lineNotice: { sent: true, reason: null } } })
  fixture.customerSearch.mockResolvedValue({ data: [] })
  fixture.customerHistory.mockResolvedValue({ data: { visitCount: 0, visits: [] } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('l9NlC0 予約台帳（今日・時間×卓）', () => {
  it('数4・時間×卓の箱（予約元・アレルギー・承認待ち・押さえ）・右の4枚が出る', async () => {
    render(<ReservationsPage />)
    await screen.findByText('山田 太郎')
    const board = document.querySelector('[data-design-node="l9NlC0"]')!
    expect(board.textContent).toContain('今日の予約')
    expect(screen.getByText('⚠ 乳')).not.toBeNull()
    expect(screen.getByText('承認待ち', { selector: 'span' })).not.toBeNull()
    expect(screen.getAllByText('押さえ', { selector: 'span' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/^🔒 20:00〜21:30$/)).not.toBeNull()
    expect(screen.getByText('個室B は停止中のため出していません')).not.toBeNull()
    expect(board.textContent).toContain('・承認待ちが 1 件（山田さん・食べログ）')
    for (const title of ['次の予約', 'つながる先']) expect(screen.getByRole('heading', { name: title })).not.toBeNull()
  })

  it('箱を押すと予約の詳細（AjZhH）が開き、「変更する」から変更の窓へ。保存は今の口へ届く', async () => {
    render(<ReservationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^佐藤 健 2名/ }))
    fireEvent.click(await screen.findByRole('button', { name: '変更する' }))
    fireEvent.change(screen.getByLabelText('お客様名'), { target: { value: '佐藤 健太' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r1', expect.objectContaining({ customerName: '佐藤 健太', tableId: 't1' })))
  })

  it('押さえの箱からは解除ができる（取消として送る）', async () => {
    render(<ReservationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^押さえ / }))
    fireEvent.click(screen.getByRole('button', { name: '押さえを解除' }))
    fireEvent.click(screen.getByRole('button', { name: '解除する' }))
    await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r3', { status: 'cancelled' }))
  })

  it('一覧（Z3FoM）は予約タイムラインの表と変更・取消が出る', async () => {
    render(<ReservationsPage />)
    await screen.findByText('山田 太郎')
    fireEvent.click(screen.getByRole('tab', { name: '一覧' }))
    await screen.findByText('予約タイムライン')
    expect(document.querySelector('[data-design-node="Z3FoM"]')).not.toBeNull()
    const row = screen.getByText('佐藤 健', { selector: 'td p' }).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r1', { status: 'cancelled' }))
  })

  it('電話の予約を入れる（rm92Y）で台帳に入れると createReservation へ送る', async () => {
    render(<ReservationsPage />)
    await screen.findByText('山田 太郎')
    fireEvent.click(screen.getByRole('button', { name: /電話の予約を入れる/ }))
    await screen.findByText('何を入れますか', { selector: 'h2' })
    expect(document.querySelector('[data-design-node="rm92Y"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'LINE 未連携の電話番号' }))
    fireEvent.change(screen.getByLabelText('お名前'), { target: { value: '鈴木 花子' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-0000-1111' } })
    fireEvent.click(screen.getByRole('button', { name: '17:00' }))
    fireEvent.click(await screen.findByRole('button', { name: /台帳に入れる/ }))
    await waitFor(() => expect(fixture.createReservation).toHaveBeenCalledWith('account-1', expect.objectContaining({ customerName: '鈴木 花子', customerPhone: '090-0000-1111', guestCount: 2, source: 'phone', kind: 'customer' })))
  })
})
