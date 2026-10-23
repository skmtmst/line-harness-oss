// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'

const fixture = vi.hoisted(() => ({ pathname: '/', version: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => createElement('a', props, children) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null, loading: false }) }))
vi.mock('@/hooks/use-account-style', () => ({ useAccountStyle: () => ({ data: { style: 'standard' }, status: 'ready' }) }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '試験会社', iconUrl: null }) }))
vi.mock('@/components/hq/account-menu', () => ({ SidebarAccountMenu: () => null }))
vi.mock('@/lib/admin-version-cache', () => ({ loadAdminVersionDetail: fixture.version }))
vi.mock('@/components/update/use-update-status', () => ({ useUpdateStatus: () => ({ kind: 'latest', version: '2.7.0' }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ hqStyleApi: { attention: async () => ({ success: true, data: { items: [] } }) } }))

import Sidebar from './sidebar'

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('lh-sidebar-collapsed', '0')
  rememberStaffIdentity({ role: 'owner' } as StaffMember)
  fixture.pathname = '/'
  fixture.version.mockResolvedValue({ version: '2.7.0', git_commit: 'a1b2c3d4', released_at: '', deploy_env: 'staging' })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); window.localStorage.clear() })

describe('サイドバーの会社表示・設定・版', () => {
  it('旧テーマだけに隠すクラスを戻さない', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sidebar.tsx'), 'utf8')
    expect(source).not.toContain('v7-only')
  })

  it.each([
    ['店舗', '/', '設定', '/settings', '統括の設定'],
    ['統括', '/hq', '統括の設定', '/hq/settings', '設定'],
  ])('%sで同じ会社表示と版を出し、対応する設定へ進める', async (_shell, pathname, label, href, otherLabel) => {
    fixture.pathname = pathname
    const view = render(createElement(Sidebar))
    // 非表示のモバイル複製ではなく、常設のサイドバーを検証する。
    const desktop = within(view.container.querySelector('aside:not(#mobile-menu)') as HTMLElement)
    expect(desktop.getByTitle('試験会社').textContent).toBe('試験会社')
    expect(desktop.getByText('musubo')).toBeTruthy()
    expect(desktop.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
    expect(desktop.queryByRole('link', { name: otherLabel })).toBeNull()
    expect(await desktop.findByText('Ver. 2.7.0（a1b2c3d）')).toBeTruthy()
    expect(desktop.getByText('検証環境')).toBeTruthy()
    expect(fixture.version).toHaveBeenCalled()
  })

  it.each([
    ['/', 'サンプルアカウント'],
    ['/hq', '試験会社'],
  ])('%sの見本では見出しを保ち、設定と版の取得を出さない', (pathname, heading) => {
    fixture.pathname = pathname
    const view = render(createElement<NonNullable<Parameters<typeof Sidebar>[0]>>(Sidebar, { preview: true }))
    const desktop = within(view.container.querySelector('aside:not(#mobile-menu)') as HTMLElement)
    expect(desktop.getByText(heading)).toBeTruthy()
    expect(desktop.queryByRole('link', { name: /^(統括の)?設定$/ })).toBeNull()
    expect(desktop.queryByText(/Ver\./)).toBeNull()
    expect(fixture.version).not.toHaveBeenCalled()
  })
})
