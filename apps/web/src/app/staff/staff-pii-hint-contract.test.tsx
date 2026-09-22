// @vitest-environment happy-dom
/*
 * LAY-09: 個人情報行の注記は「現在の状態の説明」ではなく、
 * 「伏せて見せる」選択肢の一般説明と分かる文にする。
 *
 * 以前の固定注記「メールアドレスを伏せて表示します」は、
 * 「そのまま見せる」が選択されている行にも常に出るため矛盾して見えた。
 * 現在の見せ方の説明は右欄(aside)が選択値と連動して出す。
 */
import React from 'react'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams('tab=members'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="ログインユーザーのタブ" />,
  useMergedTab: () => 'members',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
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
    roleBundle: 'operations', featureCount: 3, hasFieldMasks: false,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: '2026-09-01T00:00:00.000Z', lastActionAt: null, mfaEnabled: false,
    status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const state = {
  members: [member({}), member({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', role: 'admin' })],
  users: [
    accessUser({}),
    accessUser({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', roleBundle: 'administrator' }),
  ],
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
        update: vi.fn(async () => ({ success: true, data: state.members[0] })),
        loginSummary: async () => ({ success: true, data: { loginCount: 1 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: {
              active: 2, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 0, mfaRate: 0,
              roleCounts: { administrator: 1, operations: 1, reception: 0, view_only: 0, custom: 0 },
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

const { default: StaffPage } = await import('./page')

async function openPermissionView() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('対象者')).toBeTruthy())
  fireEvent.click(within(screen.getByText('対象者').closest('tr') as HTMLTableRowElement).getByRole('button', { name: '中身を見る' }))
  await waitFor(() => expect(screen.getByText('この決め方で、この人にはこう見えます')).toBeTruthy())
}

beforeEach(() => {
  state.users[0] = accessUser({})
})

afterEach(() => cleanup())

describe('個人情報行の注記は選択肢の一般説明と区別できる (LAY-09)', () => {
  it('「そのまま見せる」選択時に、現在の状態として「伏せて表示します」とは出さない', async () => {
    // 管理者は個人情報を「そのまま見せる」(full)。監査で矛盾と指摘された組み合わせ。
    state.users[0] = accessUser({ roleBundle: 'administrator' })
    await openPermissionView()

    const showAsIs = screen.getByRole('button', { name: '個人情報：そのまま見せる（すべて表示）' })
    expect(showAsIs.getAttribute('aria-pressed')).toBe('true')

    // 固定注記は選択肢の説明として条件付きの文になっている
    expect(screen.getByText('「伏せて見せる」を選ぶと、メールアドレスを伏せて表示します')).toBeTruthy()
    // 現在の状態を説明するかのような断定文は残っていない
    expect(screen.queryByText('メールアドレスを伏せて表示します')).toBeNull()

    // 右欄の状態説明は選択値と連動して「そのまま見えます」を出す
    expect(screen.getByText(/個人情報（電話番号・住所・メール）もそのまま見えます/)).toBeTruthy()
  })

  it('「伏せて見せる」選択時は注記と右欄の説明が矛盾しない', async () => {
    // 運用プリセットは個人情報=view（伏せて見せる）
    await openPermissionView()

    expect(screen.getByRole('button', { name: '個人情報：伏せて見せる（一部を伏せて表示）' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('「伏せて見せる」を選ぶと、メールアドレスを伏せて表示します')).toBeTruthy()
    expect(screen.getByText(/電話番号・住所・メールは伏せて表示します/)).toBeTruthy()
  })
})
