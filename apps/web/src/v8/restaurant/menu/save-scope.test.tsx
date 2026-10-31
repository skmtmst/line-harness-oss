// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 日付の見本を作る前に日本時間で固定し、待ち合わせのタイマーは動かす。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
})

const fixture = vi.hoisted(() => ({ account: 'account-1', snapshot: vi.fn(), createMenu: vi.fn(), updateMenu: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.account, accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/lib/api', async (load) => ({ ...(await load<typeof import('@/lib/api')>()), fetchApi }))
const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  useRouter: () => ({ push: nav.push, replace: nav.push, back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/restaurant-test/menu',
}))

import MenuEditPage from './edit'
import { snapshotOf } from '../booking-kit/test-data'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T12:00:00+09:00'))
  role.value = verifiedStaffRole('owner')
  fixture.account = 'account-1'; nav.params = new URLSearchParams()
  fixture.snapshot.mockResolvedValue({ data: snapshotOf() })
  fixture.createMenu.mockResolvedValue({ success: true })
  fixture.updateMenu.mockResolvedValue({ success: true })
  fetchApi.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it('メニューの保存中に店を切り替えても次の店で保存でき、旧応答で次の保存を解放しない', async () => {
 nav.params = new URLSearchParams('id=m1')
 let old!: (value: unknown) => void, fresh!: (value: unknown) => void
 fixture.updateMenu.mockImplementationOnce(() => new Promise(resolve => { old = resolve })).mockImplementationOnce(() => new Promise(resolve => { fresh = resolve }))
 const view = render(<MenuEditPage />)
 fireEvent.change(await screen.findByLabelText('メニュー名'), { target: { value: '前の店の直し' } })
 fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
 await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledTimes(1))
 fixture.account = 'account-2'; view.rerender(<MenuEditPage />)
 await waitFor(() => expect((screen.getByLabelText('メニュー名') as HTMLInputElement).value).toBe('秋の鹿肉コース'))
 fireEvent.change(screen.getByLabelText('メニュー名'), { target: { value: '次の店の直し' } })
 fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
 await waitFor(() => expect(fixture.updateMenu).toHaveBeenCalledTimes(2))
 await act(async () => { old({ success: true }) })
 expect(view.container.querySelector('button[aria-busy="true"]')).not.toBeNull()
 expect(nav.push).not.toHaveBeenCalled()
 expect((screen.getByLabelText('メニュー名') as HTMLInputElement).value).toBe('次の店の直し')
 expect(fixture.updateMenu.mock.calls.map(call => call[0])).toEqual(['account-1', 'account-2'])
 await act(async () => { fresh({ success: true }) })
 await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1))
})
