// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BookingGroupView as BookingParty } from '@line-crm/shared'

const cancelGroup = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/helpers/booking-advanced', () => ({ bookingAdvancedApi: { cancelGroup } }))
const { default: PartySection } = await import('./party-section')

const party: BookingParty = { groupId: 'g1', ownerName: '山田 花子', version: 2, members: [
  { bookingId: 'b1', label: 'チョコ', menuName: '爪切り', staffName: 'Kenta', startsAt: '2026-10-01T04:30:00.000Z', endsAt: '2026-10-01T04:45:00.000Z', status: 'confirmed' },
  { bookingId: 'b2', label: 'マロン', menuName: 'トリミング（中型犬）', staffName: '佐々木', startsAt: '2026-10-01T04:00:00.000Z', endsAt: '2026-10-01T05:30:00.000Z', status: 'confirmed' },
] }
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('人ごとのメニュー・担当・時間を並べる', () => {
  render(<PartySection party={party} canOperate currentBookingId="b1" />)
  expect(screen.getByText('この組（2 人）')).toBeTruthy()
  expect(screen.getByText('13:30〜13:45')).toBeTruthy()
  expect(screen.getByText('13:00〜14:30')).toBeTruthy()
})

test('閲覧のみの人には取消を出さない', () => {
  render(<PartySection party={party} canOperate={false} currentBookingId="b1" />)
  expect(screen.queryByRole('button', { name: '組をまとめて取り消す' })).toBeNull()
})

test('組をまとめて取り消す：口が無い間は押すと「現在準備中です」を出し、何も送らない', async () => {
  render(<PartySection party={party} canOperate currentBookingId="b1" />)
  fireEvent.click(screen.getByRole('button', { name: '組をまとめて取り消す' }))
  expect(await screen.findByText('現在準備中です')).toBeTruthy()
})


test('実APIの組IDと版を使い、理由の確認後だけまとめて取り消す', async () => {
  cancelGroup.mockResolvedValue({ success: true, data: { cancelled: 2, version: 3 } })
  const changed = vi.fn()
  render(<PartySection party={party} canOperate accountId="account-1" currentBookingId="b1" onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '組をまとめて取り消す' }))
  const confirm = screen.getByRole('button', { name: 'まとめて取り消す' })
  expect(confirm.hasAttribute('disabled')).toBe(true)
  expect(cancelGroup).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: '取り消す理由' }), { target: { value: '予定の変更' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(cancelGroup).toHaveBeenCalledWith('account-1', 'g1', '予定の変更', 2)
})

test('失敗しても理由と窓を残し、読み直しを案内する', async () => {
  cancelGroup.mockRejectedValue(new Error('conflict'))
  render(<PartySection party={party} canOperate accountId="account-1" currentBookingId="b1" onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '組をまとめて取り消す' }))
  fireEvent.change(screen.getByRole('textbox', { name: '取り消す理由' }), { target: { value: '予定の変更' } })
  fireEvent.click(screen.getByRole('button', { name: 'まとめて取り消す' }))
  expect(await screen.findByText(/取り消せませんでした。入力は残っています/)).toBeTruthy()
  expect((screen.getByRole('textbox', { name: '取り消す理由' }) as HTMLInputElement).value).toBe('予定の変更')
  expect(screen.getByRole('button', { name: 'この組を読み直す' })).toBeTruthy()
})
