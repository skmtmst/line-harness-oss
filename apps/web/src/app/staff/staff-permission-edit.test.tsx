// @vitest-environment happy-dom
/*
 * N-209 R1: 成果承認の操作権限を既存スタッフへ付与・解除する。
 *
 * 実物の staff 一覧をマウントし、編集窓を操作する。
 *   - 操作権限を選ぶと保存する顔ぶれに表示権限も組で入ること
 *   - 操作権限を外すと操作だけ外れ、表示権限は残ること
 *   - 一覧の権限要約に操作権限の名前が出て、既存の表示が崩れないこと
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
    id: 'staff-1', name: '承認担当', email: 'approve@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: ['/chats'],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'staff-1', name: '承認担当', email: 'approve@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: null, lastActionAt: null, mfaEnabled: true, status: 'active', policyVersion: 1,
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
        loginSummary: async () => ({ success: true, data: { loginCount: 3 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: { active: 1, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 1, mfaRate: null, roleCounts: { administrator: 0, operations: 1, reception: 0, view_only: 0, custom: 0 } },
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

async function openEdit(expectOp = true) {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'この人を外す' })).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'この人を外す' }))
  })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /変更を保存/ })).toBeTruthy()
  })
  if (expectOp) {
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: '成果を承認・却下する' })).toBeTruthy()
    })
  }
}

async function saveEdit() {
  return (await saveEditFull() as { permissionKeys: string[] }).permissionKeys
}

async function saveEditFull() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /変更を保存/ }))
  })
  await waitFor(() => {
    expect(fixture.updated).toHaveLength(1)
  })
  return fixture.updated[0].data
}

beforeEach(() => {
  fixture.tab = 'members'
  fixture.updated = []
  state.members = [member({})]
  state.users = [accessUser({})]
})

afterEach(() => {
  cleanup()
})

describe('既存スタッフの成果承認権限', () => {
  test('操作権限を選ぶと表示権限も組で保存される', async () => {
    await openEdit()
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: '成果を承認・却下する' }))
    })
    const keys = await saveEdit()
    expect(keys).toEqual(expect.arrayContaining(['/conversions', 'conversion.approval.edit']))
    // 元の受信箱は残る。
    expect(keys).toContain('/chats')
  })

  test('操作権限を外すと操作だけ外れ、表示権限は残る', async () => {
    state.members = [member({ permissionKeys: ['/chats', '/conversions', 'conversion.approval.edit'] })]
    await openEdit()
    const op = screen.getByRole('checkbox', { name: '成果を承認・却下する' }) as HTMLInputElement
    expect(op.checked).toBe(true)
    await act(async () => {
      fireEvent.click(op)
    })
    const keys = await saveEdit()
    expect(keys).not.toContain('conversion.approval.edit')
    expect(keys).toContain('/conversions')
  })

  test('管理者の保存では権限の顔ぶれを送らず、既存互換を保つ', async () => {
    state.members = [member({ role: 'admin', permissionKeys: [] })]
    state.users = [accessUser({ roleBundle: 'administrator' })]
    await openEdit(false)
    // 管理者に操作権限の欄は出ない。
    expect(screen.queryByRole('checkbox', { name: '成果を承認・却下する' })).toBeNull()
    const payload = (await saveEditFull()) as Record<string, unknown>
    expect(payload.permissionKeys).toBeUndefined()
  })
})
