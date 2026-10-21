// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import EmergencyScreen from './screen'

const f = vi.hoisted(() => ({
  identity: { role: 'owner', readOnly: false, roleBundle: undefined } as { role: string; readOnly: boolean; roleBundle?: string } | null,
  list: vi.fn(), accounts: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn(),
}))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffIdentity: () => f.identity }))
vi.mock('@/lib/api', () => ({ api: { health: { accounts: f.accounts } }, ApiError: class extends Error {} }))
vi.mock('@/lib/api/helpers/security-monitor', () => ({ securityMonitorApi: { list: f.list, acknowledge: f.acknowledge, resolve: f.resolve } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/components/layout/merged-tabs', () => ({ useMergedTab: (tabs: { key: string }[]) => tabs.some((t) => t.key === 'security') ? 'security' : 'health' }))
vi.mock('../sb-frame/settings-screen', () => ({ SbSettingsScreen: ({ children }: { children: ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/shared/tabs', () => ({ Tabs: ({ items }: { items: { href: string; label: string }[] }) => <nav>{items.map((i) => <a key={i.href} href={i.href}>{i.label}</a>)}</nav> }))
vi.mock('./health', () => ({ HealthPanelV8: () => <p>健全性の本体</p> }))
vi.mock('./history', () => ({ default: () => null }))
vi.mock('./history-details', () => ({ default: () => null }))

beforeEach(() => {
  f.identity = { role: 'owner', readOnly: false }
  f.accounts.mockResolvedValue({ success: true, data: [] })
  f.list.mockResolvedValue({ success: true, data: {
    items: [{ id: 'alert-1', summary: '監視の異常', ruleKey: 'login_failures', count: 21, threshold: 20,
      status: 'open', version: 3, notification: 'pending', firstDetectedAt: null, lastDetectedAt: null }],
    monitor: { status: 'unknown', lastCompletedAt: null }, configurationValid: true,
    windowMinutes: 15, offset: 0, total: 1, limit: 200,
  } })
  rememberSessionSnapshot({ impersonation: null, unfamiliarAt: null, stepUpMethod: 'none' })
})
afterEach(() => { cleanup(); forgetSessionSnapshot(); vi.clearAllMocks() })

describe('既存の運用状態への安全監視の接続', () => {
  it.each(['owner', 'admin'])('%s は4番目のタブと所属アカウントの記録を開ける', async (role) => {
    f.identity = { role, readOnly: false }
    render(<EmergencyScreen />)
    expect(screen.getByRole('link', { name: 'セキュリティの見張り' }).getAttribute('href')).toBe('/emergency?tab=security')
    await screen.findByText('監視の異常')
    expect(f.list).toHaveBeenCalledWith('account-1', 0)
    expect(screen.getByRole('button', { name: '監視の異常のその他操作' })).toBeTruthy()
  })

  it.each([{ role: 'owner', readOnly: true }, { role: 'admin', readOnly: false, roleBundle: 'view_only' }])('閲覧のみの管理者は一覧だけ確認できる', async (identity) => {
    f.identity = identity
    render(<EmergencyScreen />)
    await screen.findByText('監視の異常')
    expect(screen.queryByRole('button', { name: /のその他操作/ })).toBeNull()
  })

  it.each(['staff', 'viewer'])('%s は安全監視へ接続しない', (role) => {
    f.identity = { role, readOnly: false }
    render(<EmergencyScreen />)
    expect(screen.queryByRole('link', { name: 'セキュリティの見張り' })).toBeNull()
    expect(f.list).not.toHaveBeenCalled()
    expect(screen.getByText('健全性の本体')).toBeTruthy()
  })

  it.each(['unknown', 'impersonation'])('セッションが%sなら変更操作を出さない', async (mode) => {
    if (mode === 'unknown') forgetSessionSnapshot()
    else rememberSessionSnapshot({ impersonation: { id: 'imp-1', tenantId: 'tenant-1', mode: 'write', piiRevealed: false, startedAt: '2026-10-21T00:00:00Z' }, unfamiliarAt: null, stepUpMethod: 'none' })
    render(<EmergencyScreen />)
    await screen.findByText('監視の異常')
    expect(screen.queryByRole('button', { name: /のその他操作/ })).toBeNull()
  })

  it('代理ログインへの切替で開いた確認を捨て、戻っても自動再開しない', async () => {
    render(<EmergencyScreen />)
    fireEvent.click(await screen.findByRole('button', { name: '監視の異常のその他操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '確かめた' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => rememberSessionSnapshot({ impersonation: { id: 'imp-1', tenantId: 'tenant-1', mode: 'write', piiRevealed: false, startedAt: '2026-10-21T00:00:00Z' }, unfamiliarAt: null, stepUpMethod: 'none' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /のその他操作/ })).toBeNull()
    act(() => rememberSessionSnapshot({ impersonation: null, unfamiliarAt: null, stepUpMethod: 'none' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(f.acknowledge).not.toHaveBeenCalled()
    expect(f.resolve).not.toHaveBeenCalled()
  })
})
