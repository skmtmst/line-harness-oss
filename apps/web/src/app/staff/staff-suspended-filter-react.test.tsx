// @vitest-environment happy-dom
/*
 * 監査 R500: 無効にしたログインユーザーが一覧から消え、再有効化に戻れない。
 *
 * 実物の staff 一覧をマウントし、利用状態の絞り込みで無効の人が見つかり、
 * 変更窓から有効に戻せることを確かめる。
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
    id: 'staff-1', name: '有効担当', email: 'active@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: ['/chats'],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'staff-1', name: '有効担当', email: 'active@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: null, lastActionAt: null, mfaEnabled: true, status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', ...overrides,
  }
}

const suspendedMember = () => member({
  id: 'staff-2', name: '停止担当', email: 'suspended@example.test', isActive: false,
})
const suspendedUser = () => accessUser({
  id: 'staff-2', name: '停止担当', email: 'suspended@example.test', status: 'suspended',
})

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
            summary: { active: 1, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 1, mfaRate: null, roleCounts: { administrator: 1, operations: 1, reception: 0, view_only: 0, custom: 0 } },
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
  state.members = [member({}), suspendedMember()]
  state.users = [accessUser({}), suspendedUser()]
})

afterEach(() => {
  cleanup()
})

async function renderList() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => {
    expect(screen.getByText('有効担当')).toBeTruthy()
  })
}

async function chooseStatusFilter(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '利用状態' }))
  })
  const option = await screen.findByRole('option', { name: label })
  await act(async () => {
    fireEvent.click(option.querySelector('button') ?? option)
  })
}

describe('R500 無効にした人の再有効化', () => {
  test('初期表示では無効の人は出ない', async () => {
    await renderList()
    expect(screen.queryByText('停止担当')).toBeNull()
  })

  test('利用状態で無効のみを選ぶと無効の人が見つかる', async () => {
    await renderList()
    await chooseStatusFilter('無効のみ')
    await waitFor(() => {
      expect(screen.getByText('停止担当')).toBeTruthy()
    })
    expect(screen.getByText('無効')).toBeTruthy()
    expect(screen.queryByText('有効担当')).toBeNull()
  })

  test('無効の人の変更窓から有効に戻せる', async () => {
    await renderList()
    await chooseStatusFilter('無効のみ')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '変更する' })).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '変更する' }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'このユーザーを有効にする' })).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'このユーザーを有効にする' }))
    })
    await waitFor(() => {
      expect(fixture.updated).toHaveLength(1)
    })
    expect(fixture.updated[0].id).toBe('staff-2')
    expect(fixture.updated[0].data).toMatchObject({ isActive: true })
  })
})
