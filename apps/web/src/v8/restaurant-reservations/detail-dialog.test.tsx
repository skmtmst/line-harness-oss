// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), reservationsDay: vi.fn(), updateReservation: vi.fn(), createReservation: vi.fn(), holdReservation: vi.fn(),
  importReservation: vi.fn(), openingHours: vi.fn(), customerSearch: vi.fn(), customerHistory: vi.fn(),
}))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/lib/api/helpers/reservation-board',async importOriginal=>{const original=await importOriginal<typeof import('@/lib/api/helpers/reservation-board')>();return {...original,reservationBoardApi:{...original.reservationBoardApi,floors:vi.fn().mockResolvedValue({success:true,data:[]})}}})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), usePathname: () => '/restaurant-test/reservations', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))

import ReservationsPage from '../restaurant/reservations/reservations'
import ReservationDetailDialog from './detail-dialog'
import { at, reservation, snapshotOf } from '../restaurant/booking-kit/test-data'


/* 鈴木（Hot Pepper・T4・秋の鹿肉コース・電話あり）と、押さえ（T1）。 */
const reservationsToday = () => [
  reservation('r1', { customer_name: '鈴木 真理', source: 'hotpepper', guest_count: 4, customer_phone: '090-1234-5678', starts_at: at(0, 19), ends_at: at(0, 21), table_id: 't4', course_id: 'm1', course_name: '秋の鹿肉コース' }),
  reservation('r2', { customer_name: '押さえ', source: 'phone', status: 'pending', hold_expires_at: at(0, 23), note: '電話のお客さま用', guest_count: 2, starts_at: at(0, 20), ends_at: at(0, 21, 30), table_id: 't1' }),
]
let today: ReturnType<typeof reservationsToday>

beforeEach(() => {
  // 台帳の「今日」と「次の予約」、来店日の年比較を固定する。待ち合わせのタイマーは実時間のまま。
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
  today = reservationsToday()
  role.value = 'owner'
  fixture.snapshot.mockResolvedValue({ success: true, data: snapshotOf({ reservations: today, reservationTotal: 2 }) })
  fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: today } })
  fixture.openingHours.mockResolvedValue({ data: { storeId: 'store-1', hours: null, version: 1, updatedBy: null, updatedAt: null } })
  fixture.updateReservation.mockResolvedValue({ success: true })
  fixture.customerSearch.mockResolvedValue({ data: [] })
  // 日付表示は日本時間。端末がUTCでも8/14となるよう、見本にも時差を明示する。
  fixture.customerHistory.mockResolvedValue({ data: { visitCount: 3, visits: [{ id: 'v1', starts_at: '2026-08-14T19:00:00+09:00', guest_count: 4, allergy_note: null, table_label: null, course_name: null }] } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

const openDetail = async () => {
  render(<ReservationsPage />)
  fireEvent.click(await screen.findByRole('button', { name: /^鈴木 真理 4名/ }))
  return screen.findByRole('dialog', { name: '鈴木 真理さん・4名' })
}

describe('AjZhH 予約台帳 予約の詳細', () => {
  it('埋込の操作は下のメニュー1つにまとめ、予約元を名前と別の段で読む', async () => {
    const attendance = vi.fn()
    const data = snapshotOf({ reservations: today, reservationTotal: 2 })
    render(<ReservationDetailDialog inline reservation={today[0]} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={attendance} />)
    const panel = await screen.findByRole('region', { name: '予約の詳細' })
    expect(panel.querySelector('header [data-row-menu]')).toBeNull()
    expect(panel.querySelectorAll('footer [data-row-menu]').length).toBe(1)
    const customer = within(panel).getByText('お客さま').parentElement!
    expect(customer.textContent).toContain('鈴木 真理 さま')
    expect(customer.querySelector('[data-source]')).toBeNull()
    expect(within(panel).getByText('予約元').parentElement?.textContent).toContain('ホットペッパー')
    fireEvent.click(within(panel).getByRole('button', { name: '来店にする' }))
    expect(attendance).toHaveBeenCalledWith('r1', 'visited')
  })
  it('予約の箱で開き、日時と卓・コースと予約元・アレルギー・これまでの来店が出る', async () => {
    const dialog = await openDetail()
    const text = () => dialog.textContent ?? ''
    expect(text()).toMatch(/19:00〜21:00・T4（4 人卓）/)
    expect(text()).toContain('秋の鹿肉コース ¥8,800・Hot Pepper から')
    expect(text()).toContain('アレルギー：なし')
    await waitFor(() => expect(text()).toContain('これまでの来店 3 回・前回 08/14'))
    expect(fixture.customerHistory).toHaveBeenCalledWith('account-1', 'store-1', { phone: '090-1234-5678', lineUid: undefined })
    for (const name of ['取り消す', '内容を変える']) expect(within(dialog).getByRole('button', { name })).not.toBeNull()
  })

  it('「次の予約」の「詳細を見る」でも開く', async () => {
    render(<ReservationsPage />)
    await screen.findByRole('button', { name: /^鈴木 真理 4名/ })
    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }))
    expect(await screen.findByRole('dialog', { name: '鈴木 真理さん・4名' })).not.toBeNull()
  })

  it('取り消すは確かめの窓を通してから今の口へ取消を送る', async () => {
    const dialog = await openDetail()
    fireEvent.click(within(dialog).getByRole('button', { name: '取り消す' }))
    expect(fixture.updateReservation).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('dialog', { name: 'この予約を取り消しますか？' })
    fireEvent.click(within(confirm).getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r1', { status: 'cancelled', expectedVersion: 1 }))
  })

  it('内容を変えるで今の変更の窓へ移る', async () => {
    const dialog = await openDetail()
    fireEvent.click(within(dialog).getByRole('button', { name: '内容を変える' }))
    expect(await screen.findByRole('dialog', { name: '鈴木 真理さんの予約を変更' })).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: '鈴木 真理さん・4名' })).toBeNull()
  })

  it('押さえの箱は詳細ではなく押さえの窓を開く', async () => {
    render(<ReservationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^押さえ / }))
    expect(await screen.findByRole('button', { name: '押さえを解除' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '内容を変える' })).toBeNull()
  })

  it('閲覧のみは詳細の変更操作を理由付きで押せない', async () => {
    role.value = 'viewer'
    const dialog = await openDetail()
    expect(within(dialog).getAllByRole('button', { name: '閉じる' }).length).toBe(2)
    expect(within(dialog).getByRole('button', { name: '取り消す' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(dialog).getByRole('button', { name: '内容を変える' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByRole('button', { name: '卓を変える' })).toBeNull()
    expect(screen.queryByRole('button', { name: /電話の予約を入れる/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /に予約を入れる$/ })).toBeNull()
  })

  it.each([false, true])('閲覧のみの詳細は来店・無断を理由付きで押せない（埋込=%s）', async (inline) => {
    role.value = 'viewer'
    const attendance = vi.fn()
    const data = snapshotOf({ reservations: today, reservationTotal: 2 })
    render(<ReservationDetailDialog inline={inline} reservation={today[0]} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite={false} onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={attendance} />)
    const area = inline ? screen.getByRole('region', { name: '予約の詳細' }) : screen.getByRole('dialog', { name: '鈴木 真理さん・4名' })
    for (const name of ['来店にする', '無断にする']) {
      const button = within(area).getByRole('button', { name })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(button)
    }
    expect(attendance).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('閲覧のみのため変更できません')
  })

  it('承認待ちは無断にできず、承認が必要な理由を出す', () => {
    const data = snapshotOf({ reservations: today, reservationTotal: 2 })
    render(<ReservationDetailDialog reservation={{...today[0], status: 'pending'}} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={() => {}} />)
    const button = screen.getByRole('button', { name: '無断にする' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('承認してから')
  })

  it('来店・無断は窓の下に直接置き、無断は確認後に送る', async () => {
    const attendance = vi.fn()
    const data = snapshotOf({ reservations: today, reservationTotal: 2 })
    render(<ReservationDetailDialog reservation={today[0]} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={attendance} />)
    const dialog = await screen.findByRole('dialog', { name: '鈴木 真理さん・4名' })
    fireEvent.click(within(dialog).getByRole('button', { name: '無断にする' }))
    expect(attendance).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('alertdialog', { name: '無断にしますか？' })
    expect(confirm.textContent).toContain('鈴木 真理さん')
    expect(confirm.textContent).toContain('19:00')
    expect(confirm.textContent).toContain('送信済みの連絡は取り消せません')
    expect(within(confirm).getByRole('button', { name: '無断にする' }).getAttribute('data-variant')).toBe('danger')
    fireEvent.click(within(confirm).getByRole('button', { name: 'キャンセル' }))
    expect(attendance).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '無断にする' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '無断にしますか？' })).getByRole('button', { name: '無断にする' }))
    expect(attendance).toHaveBeenCalledWith('r1', 'no_show')
    fireEvent.click(within(dialog).getByRole('button', { name: '来店にする' }))
    expect(attendance).toHaveBeenCalledWith('r1', 'visited')
  })
  it('埋込の詳細にも無断を直接置き、確認後に no_show を送る', async () => {
    const attendance = vi.fn()
    const data = snapshotOf({ reservations: today, reservationTotal: 2 })
    render(<ReservationDetailDialog inline reservation={today[0]} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={attendance} />)
    const panel = await screen.findByRole('region', { name: '予約の詳細' })
    fireEvent.click(within(panel).getByRole('button', { name: '無断にする' }))
    expect(attendance).not.toHaveBeenCalled()
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '無断にしますか？' })).getByRole('button', { name: '無断にする' }))
    expect(attendance).toHaveBeenCalledWith('r1', 'no_show')
  })
  it('来店済みは退店にするを直接置き、無断は置かない', async () => {
    const attendance = vi.fn()
    const visited = reservation('r3', { customer_name: '佐藤 健', status: 'visited', guest_count: 2 })
    const data = snapshotOf({ reservations: [visited], reservationTotal: 1 })
    render(<ReservationDetailDialog reservation={visited} accountId="account-1" tables={data.tables} courses={data.menuItems}
      busy={false} canWrite onClose={() => {}} onCancel={() => {}} onRestore={() => {}} onEdit={() => {}} onAttendance={attendance} />)
    const dialog = await screen.findByRole('dialog', { name: '佐藤 健さん・2名' })
    fireEvent.click(within(dialog).getByRole('button', { name: '退店にする' }))
    expect(attendance).toHaveBeenCalledWith('r3', 'depart')
    expect(within(dialog).queryByRole('button', { name: '無断にする' })).toBeNull()
  })
  it('連絡先が無い予約は来店を数えない（口を呼ばない）', async () => {
    fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: [{ ...today[0], customer_phone: null }] } })
    const dialog = await openDetail()
    expect(dialog.textContent).toContain('これまでの来店：連絡先が無いので数えられません')
    expect(fixture.customerHistory).not.toHaveBeenCalled()
  })
})
