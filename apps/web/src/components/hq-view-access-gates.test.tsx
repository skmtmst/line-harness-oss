// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'

const nav = vi.hoisted(() => ({ pathname: '/hq', replace: vi.fn(), me: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: nav.replace }) }))
vi.mock('@/lib/api', () => ({ api: { staff: { me: nav.me } } }))
import HqAccessGate from './hq-access-gate'
import ViewPermissionGate from './view-permission-gate'

beforeEach(() => {
  nav.pathname = '/hq'; nav.replace.mockReset(); nav.me.mockReset().mockResolvedValue({ success: false })
  forgetStaffIdentity(); forgetSessionSnapshot()
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })
const signIn = (identity: Partial<StaffMember>) => rememberStaffIdentity(identity as StaffMember)
const gate = (mounted: () => void) => {
  function Body() { React.useEffect(mounted, []); return <p>機能の中身</p> }
  return render(<HqAccessGate><ViewPermissionGate><Body /></ViewPermissionGate></HqAccessGate>)
}

it('店舗だけの本人は統括の子をマウントせず、店舗の着地点へ戻す', () => {
  signIn({ role: 'owner', accountScope: 'accounts' })
  const mounted = vi.fn(); gate(mounted)
  expect(mounted).not.toHaveBeenCalled()
  expect(screen.queryByText('機能の中身')).toBeNull()
  expect(nav.replace).toHaveBeenCalledWith('/')
})

it('統括を使える本人は内側の門を通り、統括の中身を読める', () => {
  signIn({ role: 'owner', accountScope: 'all' })
  const mounted = vi.fn(); gate(mounted)
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(screen.getByText('機能の中身')).toBeTruthy()
  expect(nav.replace).not.toHaveBeenCalled()
})

it('店舗の画面では統括の境界を通過しても、機能の鍵なしなら子を始めない', () => {
  nav.pathname = '/broadcasts'
  signIn({ role: 'staff', accountScope: 'accounts', permissionKeys: [], permissionViewKeys: [] })
  const mounted = vi.fn(); gate(mounted)
  expect(mounted).not.toHaveBeenCalled()
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(nav.replace).not.toHaveBeenCalled()
})

it('店舗の見る鍵がある閲覧者は、同じ順の門で読める', () => {
  nav.pathname = '/broadcasts'
  signIn({ role: 'staff', accountScope: 'accounts', readOnly: true, permissionKeys: [], permissionViewKeys: ['/broadcasts'] })
  const mounted = vi.fn(); gate(mounted)
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(nav.replace).not.toHaveBeenCalled()
})

it('本人未確定の統括では子も拒否文も出さず、確定後だけ始める', async () => {
  nav.me.mockImplementation(() => new Promise(() => {}))
  const mounted = vi.fn(); gate(mounted)
  expect(mounted).not.toHaveBeenCalled()
  expect(screen.queryByText('この画面を見る権限がありません')).toBeNull()
  expect(screen.getByLabelText('読み込んでいます').getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByLabelText(/権限/)).toBeNull()
  expect(nav.replace).not.toHaveBeenCalled()
  await act(async () => { signIn({ role: 'owner', accountScope: 'all' }) })
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('統括で本人の取得に失敗したら読み直せ、成功するまで子を始めない', async () => {
  nav.me.mockResolvedValueOnce({ success: false })
  const mounted = vi.fn(); gate(mounted)
  await screen.findByText('読み込めませんでした')
  expect(mounted).not.toHaveBeenCalled()
  nav.me.mockResolvedValueOnce({ success: true, data: { role: 'owner', accountScope: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1))
  expect(nav.me).toHaveBeenCalledTimes(2)
})
