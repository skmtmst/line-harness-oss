// @vitest-environment happy-dom
/*
 * 監査 WEB061：担当の割り当ての保存に失敗しても、保存ボタンを押せなくしない（やり直せる）。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/booking/menus/assign',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    bookingApi: {
      ...actual.bookingApi,
      listMenus: async () => ({ menus: [{ id: 'm1', name: 'カット', sort_order: 1, is_active: 1 }] }),
      listStaff: async () => ({ staff: [{ id: 's1', name: '高田', display_name: '高田', is_active: 1 }] }),
      listStaffMenusBulk: async () => ({ staff: [{ staff_id: 's1', matrix: [] }] }),
      putStaffMenusBulk: (...args: unknown[]) => net.put(...args),
    },
  }
})

import AssignMatrixV8 from './assign'
afterEach(cleanup)

it('保存に失敗しても、もう一度保存を押せる', async () => {
  net.put.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true })
  render(<AssignMatrixV8 />)
  const cell = await screen.findByLabelText(/カット を .* が受ける/)
  await act(async () => { (cell as HTMLElement).click() })
  const save = () => screen.getAllByRole('button').find((button) => button.textContent?.includes('保存') && !button.textContent?.includes('キャンセル')) as HTMLButtonElement
  await act(async () => { save().click() })
  await waitFor(() => expect(net.put).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(save().disabled).toBe(false))
  await act(async () => { save().click() })
  await waitFor(() => expect(net.put).toHaveBeenCalledTimes(2))
})
