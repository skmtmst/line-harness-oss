// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@/lib/api'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'

const nav = vi.hoisted(() => ({ path: '/broadcasts', search: '', me: vi.fn(), accountMount: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { staff: { me: nav.me } } }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search) }))

import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
vi.mock('@/app/accounts/migration', () => ({ default: () => <p>UID移行</p> }))
vi.mock('@/v8/settings/accounts/accounts', () => ({ default: function AccountList() { React.useEffect(nav.accountMount, []); return <p>アカウント一覧</p> } }))
import AccountsPage from '@/app/accounts/page'
import ViewPermissionGate, { menuItemForPath } from './view-permission-gate'

beforeEach(() => { forgetStaffIdentity(); forgetSessionSnapshot(); nav.path = '/broadcasts'; nav.search = ''; nav.accountMount.mockReset(); nav.me.mockReset().mockResolvedValue({ success: false, error: 'unavailable' }) })
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); window.localStorage.clear() })

const gate = () => render(<ViewPermissionGate><p>一覧の中身</p></ViewPermissionGate>)
const signIn = (identity: Partial<StaffMember>) => {
  window.localStorage.setItem('lh_staff_role', String(identity.role))
  rememberStaffIdentity(identity as StaffMember)
}

describe('メニューに無い画面を URL で開いた時', () => {
  it('見られる鍵の無い担当者には中身を出さず、権限が無いことと［ダッシュボードへ］だけを出す', () => {
    signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: [] } as Partial<StaffMember>)
    gate()
    expect(screen.queryByText('一覧の中身')).toBeNull()
    expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
    expect(screen.getByRole('link', { name: /ダッシュボードへ/ }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
  })

  it('見られる鍵か変えられる鍵があれば中身を出す（閲覧のみの見る鍵も同じ）', () => {
    signIn({ role: 'staff', readOnly: true, roleBundle: 'view_only', permissionKeys: [], permissionViewKeys: ['/broadcasts'] } as Partial<StaffMember>)
    gate()
    expect(screen.getByText('一覧の中身')).toBeTruthy()
  })

  it('オーナー・管理者、メニューの必須の項目、メニューに無い道筋は止めない', () => {
    signIn({ role: 'owner' } as Partial<StaffMember>)
    gate()
    expect(screen.getByText('一覧の中身')).toBeTruthy()
    cleanup(); forgetStaffIdentity()
    signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: [] } as Partial<StaffMember>)
    nav.path = '/no-such-menu'
    gate()
    expect(screen.getByText('一覧の中身')).toBeTruthy()
  })

  it('いちばん長く一致するメニューの項目で決める', () => {
    expect(menuItemForPath('/broadcasts/new')?.href).toBe('/broadcasts')
    expect(menuItemForPath('/contents/vars/edit')?.href).toBe('/contents/vars')
    expect(menuItemForPath('/')?.href).toBe('/')
  })
})

it.each([
  ['/common-actions', '/automations'],
  ['/common-actions/edit', '/automations'],
  ['/common-actions/versions/detail', '/automations'],
  ['/affiliate-offers/new', '/conversions?tab=affiliates'],
  ['/affiliate-offers/edit/detail', '/conversions?tab=affiliates'],
  ['/booking/staff/new', '/booking/menus'],
])('別名 %s は所属機能 %s の見る鍵を確かめ、拒否時は子の処理を始めない', (path, key) => {
  nav.path = path
  const mounted = vi.fn()
  function Probe() { React.useEffect(mounted, []); return <p>読めた中身</p> }
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: [] })
  const view = render(<ViewPermissionGate><Probe /></ViewPermissionGate>)
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  act(() => { signIn({ role: 'staff', permissionKeys: /\/(?:new|create)(?:\/|$)/.test(path) ? [key] : [], permissionViewKeys: [key] }) })
  view.rerender(<ViewPermissionGate><Probe /></ViewPermissionGate>)
  expect(screen.getByText('読めた中身')).toBeTruthy()
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('別名のクエリは所属先の鍵で判断し、必須メニューの迂回を許さない', () => {
  nav.path = '/accounts'; nav.search = 'tab=migration&from=sidebar'
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: ['/friends'] })
  gate()
  expect(screen.getByText('一覧の中身')).toBeTruthy()
  cleanup()
  nav.path = '/staff'; nav.search = ''
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: ['/friends'] })
  gate()
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
})

it('本人の勤務は本人用の鍵で開き、管理者は予約設定の所属として開く', () => {
  nav.path = '/booking/staff/shifts'
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: ['booking.staff.own'] })
  gate()
  expect(screen.getByText('一覧の中身')).toBeTruthy()
  cleanup()
  signIn({ role: 'admin' })
  gate()
  expect(screen.getByText('一覧の中身')).toBeTruthy()
})

it.each(['owner', 'admin', 'staff'] as const)('役割 %s の閲覧のみの束は作成画面をマウントせず、見る画面は読める', role => {
  nav.path = '/broadcasts/new'
  const mounted = vi.fn()
  function Draft() { React.useEffect(mounted, []); return <p>下書き作成</p> }
  signIn({ role, readOnly: true, roleBundle: 'view_only', permissionViewKeys: ['/broadcasts'] })
  const view = render(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(screen.getByText('閲覧のみのため、ここでは作れません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  nav.path = '/broadcasts'
  view.rerender(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('権限未確定・読込失敗では作成の副作用を始めず、再読込で許可を確認してから始める', async () => {
  nav.path = '/broadcasts/new'
  let resolve!: (value: unknown) => void
  nav.me.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const mounted = vi.fn()
  function Draft() { React.useEffect(mounted, []); return <p>下書き作成</p> }
  render(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(screen.getByText('権限を確認しています')).toBeTruthy()
  await act(async () => { await Promise.resolve(); resolve({ success: false, error: 'unavailable' }) })
  expect(await screen.findByText('読み込めませんでした')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  nav.me.mockResolvedValueOnce({ success: true, data: { role: 'owner' } })
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1))
  expect(nav.me).toHaveBeenCalledTimes(2)
})

it('閲覧の代理ログインはオーナーでも作成を始めず、見る画面と書込への切替は許可する', () => {
  nav.path = '/broadcasts/new'
  signIn({ role: 'owner' })
  rememberSessionSnapshot({ impersonation: { mode: 'read' } } as unknown as Parameters<typeof rememberSessionSnapshot>[0])
  const mounted = vi.fn()
  function Draft() { React.useEffect(mounted, []); return <p>下書き作成</p> }
  const view = render(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(screen.getByText('代理ログイン（閲覧）中のため、ここでは作れません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  act(() => { rememberSessionSnapshot({ impersonation: { mode: 'write' } } as unknown as Parameters<typeof rememberSessionSnapshot>[0]) })
  expect(mounted).toHaveBeenCalledTimes(1)
  nav.path = '/broadcasts'
  act(() => { rememberSessionSnapshot({ impersonation: { mode: 'read' } } as unknown as Parameters<typeof rememberSessionSnapshot>[0]) })
  view.rerender(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(screen.getByText('下書き作成')).toBeTruthy()
})


it('見るだけの機能鍵を持つ担当者は一覧を読めても作成の副作用を始めない', () => {
  nav.path = '/common-actions/new'
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: ['/automations'] })
  const mounted = vi.fn()
  function Draft() { React.useEffect(mounted, []); return <p>下書き作成</p> }
  const view = render(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(screen.getByText('この画面を変える権限がありません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  nav.path = '/common-actions'
  view.rerender(<ViewPermissionGate><Draft /></ViewPermissionGate>)
  expect(mounted).toHaveBeenCalledTimes(1)
})


it('別画面のクエリを付けても担当者用でないアカウント詳細を開けない', () => {
  nav.path = '/accounts/detail'; nav.search = 'tab=migration'
  signIn({ role: 'staff', permissionKeys: ['/friends'], permissionViewKeys: ['/friends'] })
  gate()
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(screen.queryByText('一覧の中身')).toBeNull()
})

it('UID移行からURLのタブを外すとアカウント一覧はマウントせず、移行へ戻れば再び読める', () => {
  nav.path = '/accounts'; nav.search = 'tab=migration'
  signIn({ role: 'staff', permissionKeys: [], permissionViewKeys: ['/friends'] })
  const view = render(<ViewPermissionGate><AccountsPage /></ViewPermissionGate>)
  expect(screen.getByText('UID移行')).toBeTruthy()
  nav.search = ''
  view.rerender(<ViewPermissionGate><AccountsPage /></ViewPermissionGate>)
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(nav.accountMount).not.toHaveBeenCalled()
  nav.search = 'tab=migration'
  view.rerender(<ViewPermissionGate><AccountsPage /></ViewPermissionGate>)
  expect(screen.getByText('UID移行')).toBeTruthy()
})

it('自動で改訂下書きを作る入口だけは事前に止め、保存済み下書きの閲覧は維持する', () => {
  nav.path = '/automations/drafts'; nav.search = 'automationId=a1'
  signIn({ role: 'owner' })
  rememberSessionSnapshot({ impersonation: { mode: 'read' } } as unknown as Parameters<typeof rememberSessionSnapshot>[0])
  const mounted = vi.fn()
  function Editor() { React.useEffect(mounted, []); return <p>下書き編集</p> }
  const view = render(<ViewPermissionGate><Editor /></ViewPermissionGate>)
  expect(screen.getByText('代理ログイン（閲覧）中のため、ここでは変えられません')).toBeTruthy()
  expect(mounted).not.toHaveBeenCalled()
  nav.search = 'id=d1'
  view.rerender(<ViewPermissionGate><Editor /></ViewPermissionGate>)
  expect(screen.getByText('下書き編集')).toBeTruthy()
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('紹介の別名URLを、別機能のconversionsキーだけで許可しない', () => {
  nav.path = '/affiliate-offers'
  signIn({ role: 'staff', permissionKeys: ['/conversions'], permissionViewKeys: ['/conversions'] })
  gate()
  expect(screen.getByText('この画面を見る権限がありません')).toBeTruthy()
  expect(screen.queryByText('一覧の中身')).toBeNull()
})

it('サーバー描画では手元に権限が残っていても、確定前の子を描画しない', () => {
  signIn({ role: 'owner' })
  const child = vi.fn(() => <p>確定前の本文</p>)
  const html = renderToStaticMarkup(<ViewPermissionGate>{React.createElement(child)}</ViewPermissionGate>)
  expect(html).not.toContain('確定前の本文')
  expect(child).not.toHaveBeenCalled()
  expect(nav.me).not.toHaveBeenCalled()
})
