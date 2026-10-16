// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BookingParty } from '@/lib/api-gap2'

const cancel = vi.fn()
vi.mock('@/lib/api-gap2', () => ({ bookingPartyApi: { cancel: (...a: unknown[]) => cancel(...a) } }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: vi.fn(), notifyToast: vi.fn() }))
const { default: PartySection } = await import('./party-section')

const party: BookingParty = { groupId: 'g1', ownerName: '山田 花子', version: 2, members: [
  { bookingId: 'b1', label: 'チョコ', menuName: '爪切り', staffName: 'Kenta', startsAt: '2026-10-01T04:30:00.000Z', endsAt: '2026-10-01T04:45:00.000Z', status: 'confirmed' },
  { bookingId: 'b2', label: 'マロン', menuName: 'トリミング（中型犬）', staffName: '佐々木', startsAt: '2026-10-01T04:00:00.000Z', endsAt: '2026-10-01T05:30:00.000Z', status: 'confirmed' },
] }
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('人ごとのメニュー・担当・時間を並べる', () => {
  render(<PartySection party={party} accountId="a1" canOperate currentBookingId="b1" onChanged={() => {}} />)
  expect(screen.getByText('この組（2 人）')).toBeTruthy()
  expect(screen.getByText('13:30〜13:45')).toBeTruthy()
  expect(screen.getByText('13:00〜14:30')).toBeTruthy()
})

test('閲覧のみの人には取消を出さない', () => {
  render(<PartySection party={party} accountId="a1" canOperate={false} currentBookingId="b1" onChanged={() => {}} />)
  expect(screen.queryByRole('button', { name: '組をまとめて取り消す' })).toBeNull()
})

test('組をまとめて取り消す：確かめの窓を通し、版を添えて送る', async () => {
  cancel.mockResolvedValue({ success: true, data: { cancelled: 2 } })
  const onChanged = vi.fn()
  render(<PartySection party={party} accountId="a1" canOperate currentBookingId="b1" onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: '組をまとめて取り消す' }))
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: '組を取り消す' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('a1', 'g1', { scope: 'all', bookingId: undefined, expectedVersion: 2 }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
})
