// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@/lib/api'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'

const nav = vi.hoisted(() => ({ path: '/', me: vi.fn() }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/api', () => ({ api: { staff: { me: nav.me } } }))
vi.mock('@/lib/menu', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/menu')>()
  return { ...actual, MENU_SECTIONS: [...actual.MENU_SECTIONS, {
    id: 'future-catalog', label: null, title: '登録済みの入口',
    items: ['/notifications', '/updates', '/support', '/restaurant-test', '/restaurant-test/stores', '/scoring', '/scoring/new', '/health'].map(href => ({ id: href, href, label: '新しい所属', icon: '', note: '', permissionKey: 'future.access' })),
  }] }
})
import ViewPermissionGate from './view-permission-gate'

afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); localStorage.clear() })

it.each(['/notifications', '/updates', '/support', '/restaurant-test', '/restaurant-test/stores', '/scoring', '/scoring/new', '/health'])('後から %s に所属が登録されたら、古い例外で新しい鍵の拒否を上書きしない', path => {
  nav.path = path
  nav.me.mockResolvedValue({ success: false, error: 'unavailable' })
  const signIn = (edit: string[], view: string[]) => rememberStaffIdentity({ role: 'staff', accountScope: 'all', permissionKeys: edit, permissionViewKeys: view } as StaffMember)
  signIn([], path === '/health' ? ['/health'] : ['/friends'])
  const mounted = vi.fn()
  function Probe() { React.useEffect(mounted, []); return <p>新しい所属の中身</p> }
  render(<ViewPermissionGate><Probe /></ViewPermissionGate>)
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  act(() => { signIn([], ['future.access']) })
  if (path.endsWith('/new')) {
    expect(screen.getByText('この画面を変える権限がありません')).toBeTruthy()
    expect(mounted).not.toHaveBeenCalled()
  } else expect(mounted).toHaveBeenCalledTimes(1)
  act(() => { signIn(['future.access'], []) })
  expect(screen.getByText('新しい所属の中身')).toBeTruthy()
  expect(mounted).toHaveBeenCalledTimes(1)
})
