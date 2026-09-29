// @vitest-environment happy-dom
/*
 * 監査 R497・R498 の画面側。
 *
 * R497: 見せる範囲の画面で、表にない保存済み権限（オートメーション）が
 * 「保存してもそのまま残す」と出る。
 * R498: 個別編集の保存ボタンの二度押しは1回の保存だけ送る。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  tab: 'members',
  updated: [] as Array<{ id: string; data: unknown }>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams(`tab=${fixture.tab}`),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="ログインユーザーのタブ" />,
  useMergedTab: () => fixture.tab,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/staff/login-audit', () => ({ default: () => <div /> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))

function member(overrides: Partial<StaffMember>): StaffMember {
  return {
    id: 'staff-1', name: '権限担当', email: 'perm@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: ['/chats', '/automations'],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, policyVersion: 3, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'staff-1', name: '権限担当', email: 'perm@example.test', jobTitle: null,
    roleBundle: 'custom', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: null, lastActionAt: null, mfaEnabled: true, status: 'active', policyVersion: 3,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', ...overrides,
  }
}

const state = {
  members: [] as StaffMember[],
  users: [] as ReturnType<typeof accessUser>[],
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return {
    ApiError,
    fetchApi: vi.fn(),
    api: {
      staff: {
        list: async () => ({ success: true, data: state.members }),
        me: async () => ({ success: true, data: member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin', isActive: true }) }),
        update: async (id: string, data: unknown) => {
          fixture.updated.push({ id, data })
          return { success: true, data: member({}) }
        },
        loginSummary: async () => ({ success: true, data: { loginCount: 0 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: { active: 1, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 1, mfaRate: null, roleCounts: { administrator: 1, operations: 0, reception: 0, view_only: 0, custom: 1 } },
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

const { default: StaffPage } = await import('./page')

beforeEach(() => {
  fixture.tab = 'members'
  fixture.updated = []
  state.members = [member({})]
  state.users = [accessUser({})]
})

afterEach(() => {
  cleanup()
})

describe('R497/R498 権限保存の画面', () => {
  test('表にない保存済み権限は残すと出る', async () => {
    await act(async () => { render(<StaffPage />) })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '中身を見る' })).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '中身を見る' }))
    })
    await waitFor(() => {
      expect(screen.getByText(/この表にない権限1件/)).toBeTruthy()
    })
    expect(screen.getByText(/オートメーション.*そのまま残します/)).toBeTruthy()
  })

  test('保存ボタンの二度押しは1回だけ送り、版と要求キーを付ける', async () => {
    await act(async () => { render(<StaffPage />) })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '変更する' })).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /変更を保存/ })).toBeTruthy()
    })
    await act(async () => {
      const save = screen.getByRole('button', { name: /変更を保存/ })
      fireEvent.click(save)
      fireEvent.click(save)
    })
    await waitFor(() => {
      expect(fixture.updated).toHaveLength(1)
    })
    const sent = fixture.updated[0].data as Record<string, unknown>
    expect(typeof sent.idempotencyKey).toBe('string')
    expect(sent.expectedPolicyVersion).toBe(3)
  })
})
