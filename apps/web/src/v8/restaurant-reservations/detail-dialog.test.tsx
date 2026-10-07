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

import ReservationsPage from '../restaurant/reservations/reservations'
import { at, reservation, snapshotOf } from '../restaurant/booking-kit/test-data'

/* 鈴木（Hot Pepper・T4・秋の鹿肉コース・電話あり）と、押さえ（T1）。 */
const today = [
  reservation('r1', { customer_name: '鈴木 真理', source: 'hotpepper', guest_count: 4, customer_phone: '090-1234-5678', starts_at: at(0, 19), ends_at: at(0, 21), table_id: 't4', course_id: 'm1', course_name: '秋の鹿肉コース' }),
  reservation('r2', { customer_name: '押さえ', source: 'phone', status: 'pending', hold_expires_at: at(0, 23), note: '電話のお客さま用', guest_count: 2, starts_at: at(0, 20), ends_at: at(0, 21, 30), table_id: 't1' }),
]

beforeEach(() => {
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ success: true, data: snapshotOf({ reservations: today, reservationTotal: 2 }) })
  fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: today } })
  fixture.openingHours.mockResolvedValue({ data: { storeId: 'store-1', hours: null, version: 1, updatedBy: null, updatedAt: null } })
  fixture.updateReservation.mockResolvedValue({ success: true })
  fixture.customerSearch.mockResolvedValue({ data: [] })
  fixture.customerHistory.mockResolvedValue({ data: { visitCount: 3, visits: [{ id: 'v1', starts_at: new Date(2026, 7, 14, 19).toISOString(), guest_count: 4, allergy_note: null, table_label: null, course_name: null }] } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const openDetail = async () => {
  render(<ReservationsPage />)
  fireEvent.click(await screen.findByRole('button', { name: /^鈴木 真理 4名/ }))
  return screen.findByRole('dialog', { name: '鈴木 真理さん・4名' })
}

describe('AjZhH 予約台帳 予約の詳細', () => {
  it('予約の箱で開き、日時と卓・コースと予約元・アレルギー・これまでの来店が出る', async () => {
    const dialog = await openDetail()
    const text = () => dialog.textContent ?? ''
    expect(text()).toMatch(/19:00〜21:00 ・ T4（4人卓）/)
    expect(text()).toContain('秋の鹿肉コース 8,800円 ・ Hot Pepper から')
    expect(text()).toContain('アレルギー：なし')
    await waitFor(() => expect(text()).toContain('これまでの来店 3回・前回 8/14'))
    expect(fixture.customerHistory).toHaveBeenCalledWith('account-1', 'store-1', { phone: '090-1234-5678', lineUid: undefined })
    for (const name of ['取り消す', '変更する']) expect(within(dialog).getByRole('button', { name })).not.toBeNull()
  })

  it('「次の予約」の「詳細を見る」でも開く', async () => {
    // 「次の予約」は今より後の予約だけ出る。19:00 の予約が「次」になるよう、今日の 12:00 に時計を止める
    // （止めないと、夜に回したときだけ落ちる）。時計だけを止め、待ち合わせの時間は止めない。
    const noon = new Date(); noon.setHours(12, 0, 0, 0)
    vi.useFakeTimers({ toFake: ['Date'], now: noon })
    try {
      render(<ReservationsPage />)
      await screen.findByRole('button', { name: /^鈴木 真理 4名/ })
      fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))
      expect(await screen.findByRole('dialog', { name: '鈴木 真理さん・4名' })).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('取り消すは確かめの窓を通してから今の口へ取消を送る', async () => {
    const dialog = await openDetail()
    fireEvent.click(within(dialog).getByRole('button', { name: '取り消す' }))
    expect(fixture.updateReservation).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('dialog', { name: 'この予約を取り消しますか？' })
    fireEvent.click(within(confirm).getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r1', { status: 'cancelled' }))
  })

  it('変更するで今の変更の窓へ移る', async () => {
    const dialog = await openDetail()
    fireEvent.click(within(dialog).getByRole('button', { name: '変更する' }))
    expect(await screen.findByRole('dialog', { name: '鈴木 真理さんの予約を変更' })).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: '鈴木 真理さん・4名' })).toBeNull()
  })

  it('押さえの箱は詳細ではなく押さえの窓を開く', async () => {
    render(<ReservationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^押さえ / }))
    expect(await screen.findByRole('button', { name: '押さえを解除' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '変更する' })).toBeNull()
  })

  it('閲覧のみには 取り消す・変更する・卓を変える・予約を入れる を置かない', async () => {
    role.value = 'viewer'
    const dialog = await openDetail()
    expect(within(dialog).getAllByRole('button', { name: '閉じる' }).length).toBe(2)
    expect(within(dialog).queryByRole('button', { name: '取り消す' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '変更する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '卓を変える' })).toBeNull()
    expect(screen.queryByRole('button', { name: /電話の予約を入れる/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /に予約を入れる$/ })).toBeNull()
  })

  it('連絡先が無い予約は来店を数えない（口を呼ばない）', async () => {
    fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: [{ ...today[0], customer_phone: null }] } })
    const dialog = await openDetail()
    expect(dialog.textContent).toContain('これまでの来店：連絡先が無いので数えられません')
    expect(fixture.customerHistory).not.toHaveBeenCalled()
  })
})
