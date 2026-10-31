// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StaffMember } from '@/lib/api'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
import unlisted from '@/test-utils/view-permission-unlisted-cases.json'

const nav = vi.hoisted(() => ({ path: '/accounts' }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/api', () => ({ api: { staff: { me: vi.fn().mockResolvedValue({ success: false }) }, tenants: { me: vi.fn().mockResolvedValue({ success: false }) } } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, loading: false, refreshing: false }) }))
vi.mock('@/components/shell/notification-center-data', () => ({ loadNotificationCenter: vi.fn().mockResolvedValue({ unreadCount: 0 }) }))
vi.mock('@/lib/use-manual-href', () => ({ useManualHref: () => undefined }))
import { defaultTitleForPath, entryTitleForPath } from '@/lib/page-title'
import ViewPermissionGate from './view-permission-gate'
import AppTopBar from './shell/app-top-bar'
import { PageChromeProvider, usePageTitle } from './shell/page-chrome'
import { DocumentTitleProvider } from './shell/document-title'

// 実画面の題・転送先を照合した期待。製品の名前の表からは作らない。
const entries: Array<[string, string]> = [
  ['/accounts/detail', 'LINEアカウントの詳細'],
  ['/accounts/handover', '乗り換え'],
  ['/accounts', 'LINEアカウント'],
  ['/booking/passes/new', '回数券・月謝を作る'],
  ['/booking/sales', '予約からの売上'],
  ['/health', 'BAN検知ダッシュボード'],
  ['/line-notifications/operator/new', '運用者へのお知らせを作る'],
  ['/line-notifications', 'LINE通知'],
  ['/notifications', '通知'],
  ['/recipes/clone', 'レシピを複製する'],
  ['/recipes', 'レシピから作る'],
  ['/restaurant-test/approvals', '承認の流れ'],
  ['/restaurant-test/dashboard', 'ダッシュボード'],
  ['/restaurant-test/organization', '組織・権限'],
  ['/restaurant-test', 'アカウント'],
  ['/restaurant-test/stores', 'アカウント'],
  ['/scoring/new', 'たまる決めごとを作る'],
  ['/scoring', 'マイル'],
  ['/search-console', 'Search Console'],
  ['/support', '問い合わせ'],
  ['/updates', 'アップデート履歴'],
  ['/users', '統合ユーザー'],
  ['/visual-qa/heading-band', '見出しの閲覧帯の確認'],
  ['/visual-qa/v8-parts', 'V8の部品の確認'],
]
beforeEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot()
  rememberStaffIdentity({ role: 'staff', accountScope: 'all', readOnly: true, roleBundle: 'view_only', permissionKeys: [], permissionViewKeys: [] } as unknown as StaffMember)
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot(); localStorage.clear() })

function Shell({ children }: { children?: React.ReactNode }) {
  return <DocumentTitleProvider pathname={nav.path}><PageChromeProvider><AppTopBar /><ViewPermissionGate>{children}</ViewPermissionGate></PageChromeProvider></DocumentTitleProvider>
}

it('未所属入口の全24口を重複なく調べ、名前を子の入口まで広げない', () => {
  expect(entries).toHaveLength(24)
  expect(entries.map(([path]) => path).sort()).toEqual(unlisted.map(row => row.route).sort())
  expect(new Set(entries.map(([path]) => path)).size).toBe(24)
  for (const [path, title] of entries) {
    expect(entryTitleForPath(path)).toBe(title)
    expect(entryTitleForPath(path + '/unknown-child')).toBe('')
  }
  expect(entryTitleForPath('/unknown-entry')).toBe('')
})

it.each(entries)('%s は拒否時にも実物の題とパンくずを出し、画面を始めない', (path, title) => {
  nav.path = path
  const mounted = vi.fn()
  function Probe() { React.useEffect(mounted, []); return <p>許可した中身</p> }
  render(<Shell><Probe /></Shell>)
  const crumbs = screen.getByRole('navigation', { name: 'パンくず' })
  expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe(title)
  expect(defaultTitleForPath(path)).toBe(title)
  expect(document.title).toBe(title + ' | musubo')
  expect(screen.queryByRole('heading', { name: '画面', exact: true })).toBeNull()
  const row = unlisted.find(row => row.route === path)!
  const passes = row.policy === 'self' || (row.policy === 'redirect' && !path.endsWith('/new'))
  if (passes) {
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('許可した中身')).toBeTruthy()
  } else {
    expect(screen.getByRole('heading', { name: title, exact: true })).toBeTruthy()
    expect(mounted).not.toHaveBeenCalled()
    expect(screen.queryByText('許可した中身')).toBeNull()
  }
  expect(within(crumbs).getByRole('link', { name: 'ホーム' })).toBeTruthy()
})

it.each(['/accounts/detail', '/accounts/handover'])('%s は店だけの人の拒否時にも入口の題を出す', path => {
  nav.path = path
  rememberStaffIdentity({ role: 'admin', accountScope: 'assigned', permissionKeys: [], permissionViewKeys: [] } as unknown as StaffMember)
  render(<Shell><p>許可した中身</p></Shell>)
  expect(screen.getByRole('heading', { name: entryTitleForPath(path), exact: true })).toBeTruthy()
  expect(screen.queryByText('許可した中身')).toBeNull()
})

it('許可された本人が登録した題を、入口の固定名で上書きしない', () => {
  nav.path = '/accounts/detail'
  rememberStaffIdentity({ role: 'owner', accountScope: 'all' } as StaffMember)
  function Detail() { usePageTitle('本店のLINE'); return <p>詳細の中身</p> }
  render(<Shell><Detail /></Shell>)
  expect(screen.getByRole('navigation', { name: 'パンくず' }).querySelector('[aria-current="page"]')?.textContent).toBe('本店のLINE')
  expect(document.title).toBe('本店のLINE | musubo')
  expect(screen.getByText('詳細の中身')).toBeTruthy()
})

it('メニューに残っている画面と未登録の道の既定は変えない', () => {
  expect(defaultTitleForPath('/broadcasts')).toBe('一斉配信')
  expect(defaultTitleForPath('/broadcasts/new')).toBe('一斉配信')
  expect(defaultTitleForPath('/unknown-entry')).toBe('')
})
