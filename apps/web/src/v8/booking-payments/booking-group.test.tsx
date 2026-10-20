// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ group: vi.fn(), cancelGroup: vi.fn() }))
vi.mock('@/lib/api/helpers/booking-advanced', () => ({ bookingAdvancedApi: net }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: vi.fn() }))
import { BookingGroupSection } from './booking-group'
afterEach(cleanup)
const group = (version: number) => ({ success: true, data: { groupId: 'g1', ownerName: '確認用の人', version, members: [1, 2].map((n) => ({ bookingId: `b${n}`, label: `${n}人目`, personName: `${n}人目`, menuName: 'メニュー', staffName: null, startsAt: '2026-10-18T01:00:00Z', endsAt: '2026-10-18T02:00:00Z', status: 'confirmed' })) } })
it('競合から読み直しても理由を保持し、新しい版でだけ再試行する', async () => {
  net.group.mockResolvedValueOnce(group(2)).mockResolvedValue(group(3))
  net.cancelGroup.mockRejectedValueOnce(new Error('conflict')).mockResolvedValue({ success: true, data: { cancelled: 2, version: 4 } })
  const changed = vi.fn()
  render(<BookingGroupSection accountId="a1" bookingId="b1" canOperate onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: '組をまとめて取り消す' }))
  fireEvent.change(screen.getByRole('textbox', { name: '取り消す理由' }), { target: { value: '予定の変更' } })
  fireEvent.click(screen.getByRole('button', { name: 'まとめて取り消す' }))
  await screen.findByText(/取り消せませんでした。入力は残っています/)
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'この組を読み直す' }))
  await waitFor(() => expect(net.group).toHaveBeenCalledTimes(2))
  expect((screen.getByRole('textbox', { name: '取り消す理由' }) as HTMLInputElement).value).toBe('予定の変更')
  fireEvent.click(screen.getByRole('button', { name: 'まとめて取り消す' }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(net.cancelGroup).toHaveBeenLastCalledWith('a1', 'g1', '予定の変更', 3)
})
