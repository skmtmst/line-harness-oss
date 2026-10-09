// @vitest-environment happy-dom
/* 入力の誤りは欄で一度だけ知らせ、保存せず最初の欄へ移動する。 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  updateStaff: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams('tab=members'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: ({ tabs }: { tabs: Array<{ key: string; label: string }> }) => <nav aria-label="ログインユーザーのタブ">{tabs.map((tab) => <span key={tab.key}>{tab.label}</span>)}</nav>,
  useMergedTab: () => 'members',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, useSettingsNavInline: () => undefined }))
vi.mock('@/components/staff/login-audit', () => ({ default: () => <div /> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))

function member(overrides: Partial<StaffMember>): StaffMember {
  return {
    id: 'target', name: '対象者', email: 'target@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: ['/chats'],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'target', name: '対象者', email: 'target@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: 9, hasFieldMasks: true,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: '2026-09-01T00:00:00.000Z', lastActionAt: null, mfaEnabled: false,
    status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const state = {
  members: [
    member({}),
    member({ id: 'admin-1', name: '管理者さん', email: 'admin@example.test', role: 'admin' }),
    member({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', role: 'admin' }),
  ],
  users: [
    accessUser({}),
    accessUser({ id: 'admin-1', name: '管理者さん', email: 'admin@example.test', roleBundle: 'administrator', featureCount: null }),
    accessUser({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', roleBundle: 'administrator' }),
  ],
  lineAccounts: [] as Array<{ id: string; name: string }>,
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return {
    ApiError,
    fetchApi: vi.fn(),
    api: {
      staff: {
        list: async () => ({ success: true, data: state.members }),
        me: async () => ({ success: true, data: state.members.find((item) => item.id === 'me')! }),
        update: fixture.updateStaff,
        loginSummary: async () => ({ success: true, data: { loginCount: 1 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: state.lineAccounts }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: {
              active: state.users.length, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 0, mfaRate: 0,
              roleCounts: { administrator: 2, operations: 1, reception: 0, view_only: 0, custom: 0 },
            },
            pagination: { total: state.users.length, limit: 200, offset: 0 },
          },
        }),
        roles: async () => ({ success: true, data: { items: [] } }),
      },
      audit: { events: async () => ({ success: true, data: { items: [] } }) },
    },
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: StaffPage } = await import('./staff')


beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('V8 ログインユーザーの入力確認', () => {
  it('名前が空なら送信せず、赤い欄へ移動する', async () => {
    fixture.updateStaff.mockReset()
    const scroll = vi.fn()
    const originalScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    try {
      render(<StaffPage />)
      await waitFor(() => expect(screen.getByRole('button', { name: '対象者の操作' })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: '対象者の操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: '役割を変える' }))
      const name = within(screen.getByRole('dialog')).getByRole('textbox', { name: /^名前/ }) as HTMLInputElement
      fireEvent.change(name, { target: { value: '' } })
      fireEvent.click(screen.getByRole('button', { name: /保存する/ }))
      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(name)
      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
      expect(screen.getAllByText('名前を入力してください')).toHaveLength(1)
      expect(fixture.updateStaff).not.toHaveBeenCalled()
    } finally { HTMLElement.prototype.scrollIntoView = originalScroll }
  })
})
