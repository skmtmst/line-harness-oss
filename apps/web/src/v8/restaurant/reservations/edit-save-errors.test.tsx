// @vitest-environment happy-dom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), reservationsDay: vi.fn(), updateReservation: vi.fn(), createReservation: vi.fn(), holdReservation: vi.fn(),
  floors: vi.fn(), importReservation: vi.fn(), openingHours: vi.fn(), customerSearch: vi.fn(), customerHistory: vi.fn(),
}))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/lib/api/helpers/reservation-board',async importOriginal=>{const original=await importOriginal<typeof import('@/lib/api/helpers/reservation-board')>();return {...original,reservationBoardApi:{...original.reservationBoardApi,floors:fixture.floors}}})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), usePathname: () => '/restaurant-test/reservations', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', async importOriginal => ({ ...await importOriginal<typeof import('@/contexts/account-context')>(), useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))

import ReservationsPage from './reservations'
import { useStaffIdentity } from '@/lib/staff-role'
// 実アプリの外枠と同じく、編集窓を閉じても本人確認の購読を維持する。
function TestPage() { useStaffIdentity(); return <ReservationsPage /> }
import { ApiError } from '@/lib/api'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
import { at, reservation, snapshotOf } from '../booking-kit/test-data'

/* 今日：佐藤（LINE・T1）・山田（食べログ・承認待ち・T3・乳）・押さえ（T4）。 */
const reservationsToday = () => [
  reservation('r1', { customer_name: '佐藤 健', source: 'line', starts_at: at(0, 18), ends_at: at(0, 20), table_id: 't1' }),
  reservation('r2', { customer_name: '山田 太郎', source: 'tabelog', status: 'pending', allergy_note: '乳', guest_count: 4, starts_at: at(0, 18, 30), ends_at: at(0, 20, 30), table_id: 't3', course_name: 'おまかせコース' }),
  reservation('r3', { customer_name: '押さえ', source: 'phone', status: 'pending', hold_expires_at: at(0, 23), note: '電話のお客さま用', guest_count: 4, starts_at: at(0, 20), ends_at: at(0, 21, 30), table_id: 't4' }),
]

let today: ReturnType<typeof reservationsToday>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
  today = reservationsToday()
  role.value = verifiedStaffRole('owner')
  fixture.floors.mockResolvedValue({success:true,data:[]})
  fixture.snapshot.mockResolvedValue({ success: true, data: snapshotOf({ reservations: today, reservationTotal: 3 }) })
  fixture.reservationsDay.mockResolvedValue({ data: { date: '', reservations: today } })
  fixture.openingHours.mockResolvedValue({ data: { storeId: 'store-1', hours: null, version: 1, updatedBy: null, updatedAt: null } })
  for (const fn of [fixture.updateReservation, fixture.importReservation]) fn.mockResolvedValue({ success: true })
  fixture.createReservation.mockResolvedValue({ success: true, data: { id: 'new', tableId: 't2', lineNotice: { sent: true, reason: null } } })
  fixture.customerSearch.mockResolvedValue({ data: [] })
  fixture.customerHistory.mockResolvedValue({ data: { visitCount: 0, visits: [] } })
})
afterEach(() => { cleanup(); verifiedStaffRole(null); forgetSessionSnapshot(); vi.useRealTimers(); vi.clearAllMocks() })


const reason = '人数・休業・卓の停止を確認してください'
async function openEdit() {
  render(<TestPage />)
  await screen.findByText('山田 太郎')
  fireEvent.click(screen.getByRole('button', { name: '一覧', exact: true }))
  const row = (await screen.findByRole('button', { name: '佐藤 健', exact: true })).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: '佐藤 健のその他操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '変更', exact: true }))
  const dialog = screen.getByRole('dialog')
  const input = within(dialog).getByLabelText('人数') as HTMLInputElement
  fireEvent.change(input, { target: { value: '9' } })
  return { dialog, input }
}
async function rejectEdit(error = new ApiError(409, reason, 'availability_conflict')) {
  fixture.snapshot.mockImplementation(async () => ({ success: true, data: snapshotOf({ reservations: today.map(row => ({ ...row })), reservationTotal: 3 }) }))
  fixture.updateReservation.mockRejectedValueOnce(error)
  const opened = await openEdit()
  const readsBefore = fixture.snapshot.mock.calls.length
  await act(async () => { fireEvent.click(within(opened.dialog).getByRole('button', { name: '保存する' })); await Promise.resolve() })
  await waitFor(() => expect(fixture.updateReservation).toHaveBeenCalledTimes(1))
  await waitFor(() => expect((within(opened.dialog).getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(false))
  return { ...opened, readsBefore }
}

it('空席競合で保存を断られても入力した人数を保つ', async () => {
  const { input } = await rejectEdit()
  expect(input.value).toBe('9')
  expect(fixture.updateReservation).toHaveBeenCalledWith('account-1', 'r1', expect.objectContaining({ guestCount: 9, expectedVersion: 1 }))
})
it('欄を特定しない空席競合の理由は編集窓の中に出す', async () => {
  const { dialog } = await rejectEdit()
  expect(within(dialog).queryByText(reason, { exact: false })).not.toBeNull()
  const notices = [...document.querySelectorAll('[data-design-part="notice"]')].filter(el => el.textContent?.includes(reason))
  expect(notices).toHaveLength(1)
  expect(dialog.contains(notices[0])).toBe(true)
})
it('入力を直して保存できたら前の失敗を残さない', async () => {
  const { dialog, input } = await rejectEdit()
  fixture.updateReservation.mockImplementation(async (_account: string, _id: string, patch: { guestCount: number }) => { today[0].guest_count = patch.guestCount; return { success: true } })
  fireEvent.change(input, { target: { value: '1' } })
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '保存する' })); await Promise.resolve() })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fixture.updateReservation).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(reason, { exact: false })).toBeNull()
})

it.each([400, 422])('入力失敗%sは読み直さず人数を残す', async status => {
  const { dialog, input, readsBefore } = await rejectEdit(new ApiError(status, '入力を確認してください'))
  expect(input.value).toBe('9')
  expect(fixture.snapshot).toHaveBeenCalledTimes(readsBefore)
  expect(within(dialog).getByRole('alert').textContent).toContain('入力を確認してください')
})
it.each([
  [409, undefined, '同じ卓に重なる時間の予約があるため変更できません'],
  [409, 'version_conflict', '最新の予約を確認してください'],
  [403, undefined, '権限がありません'], [500, undefined, '内部の失敗'],
] as const)('対象外の失敗%s/%sは従来どおり知らせて読み直す', async (status, code, message) => {
  const { dialog, input, readsBefore } = await rejectEdit(new ApiError(status, message, code))
  await waitFor(() => expect(fixture.snapshot).toHaveBeenCalledTimes(readsBefore + 1))
  await waitFor(() => expect(input.value).toBe('2'))
  expect(within(dialog).queryByRole('alert')).toBeNull()
  const notices = [...document.querySelectorAll('[data-design-part="notice"]')]
  expect(notices.some(node => !dialog.contains(node))).toBe(true)
  if (code === 'version_conflict') {
    fireEvent.change(input, { target: { value: '1' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '保存する' })) })
    expect(fixture.updateReservation.mock.calls[1][2].expectedVersion).toBe(1)
  }
})
it.each([
  ['customerName', 'お客様名'], ['customerPhone', '電話番号'], ['guestCount', '人数'],
  ['startsAt', '開始日時'], ['endsAt', '終了日時'], ['tableId', '卓'], ['courseId', 'コース'],
] as const)('APIが明示した%sの理由を対応する欄だけに出す', async (key, label) => {
  const fieldReason = 'この欄の入力を確認してください。'
  const { dialog, input } = await rejectEdit(new ApiError(422, '入力を確認してください', undefined, undefined, undefined, undefined, { [key]: fieldReason }))
  expect(input.value).toBe('9')
  const invalid = within(dialog).getAllByLabelText(label).filter(el => el.getAttribute('aria-invalid') === 'true')
  expect(invalid.length).toBeGreaterThan(0)
  expect(within(dialog).getAllByText(fieldReason)).toHaveLength(1)
  expect(dialog.querySelector('[data-design-part=notice]')).toBeNull()
})
it('編集窓に無い状態欄の理由は推測せず共通の1行へ出す', async () => {
  const { dialog } = await rejectEdit(new ApiError(400, '状態を確認してください。', undefined, undefined, undefined, undefined, { status: '状態は変更できません。' }))
  expect(within(dialog).getByRole('alert').textContent).toContain('状態を確認してください。')
  expect(dialog.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
})
it('閉じて同じ予約を開き直すと局所理由と入力は残らない', async () => {
  const { dialog } = await rejectEdit()
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' })) })
  const discard = screen.getByRole('dialog', { name: '入力を破棄しますか？' })
  await act(async () => { fireEvent.click(within(discard).getByRole('button', { name: '破棄する' })) })
  expect(screen.queryByRole('dialog')).toBeNull()
  const row = screen.getByRole('button', { name: '佐藤 健', exact: true }).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: '佐藤 健のその他操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '変更', exact: true }))
  const reopened = screen.getByRole('dialog')
  expect((within(reopened).getByLabelText('人数') as HTMLInputElement).value).toBe('2')
  expect(within(reopened).queryByText(reason, { exact: false })).toBeNull()
})
