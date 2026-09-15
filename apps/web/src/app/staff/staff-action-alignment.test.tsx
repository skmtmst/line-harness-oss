// @vitest-environment happy-dom
/*
 * N-428/N-429/N-431 (#834): 表示している操作と実際の処理を一致させる。
 *
 * ソース文字列ではなく実物の StaffPage をマウントし、次を確かめる。
 *   - 別ユーザーの権限のかたまりは下書きへコピーするだけで、保存前は更新しない
 *   - 二段階認証の操作はログイン中の本人にだけ出す
 *   - 「この人を外す」は確認後に一度だけ停止口を呼び、失敗理由を窓に残す
 */
import React from 'react'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  updateStaff: vi.fn(),
  deleteStaff: vi.fn(),
}))

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
  members: [
    member({}),
    member({ id: 'source', name: 'コピー元さん', email: 'source@example.test', role: 'viewer' }),
    member({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', role: 'admin' }),
  ],
  users: [
    accessUser({}),
    accessUser({ id: 'source', name: 'コピー元さん', email: 'source@example.test', roleBundle: 'view_only' }),
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
        update: fixture.updateStaff,
        delete: fixture.deleteStaff,
        loginSummary: async () => ({ success: true, data: { loginCount: 1 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: {
              active: 3, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 0, mfaRate: 0,
              roleCounts: { administrator: 1, operations: 1, reception: 0, view_only: 1, custom: 0 },
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

async function mount() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('対象者')).toBeTruthy())
}

function rowFor(name: string): HTMLTableRowElement {
  return screen.getByText(name).closest('tr') as HTMLTableRowElement
}

beforeEach(() => {
  fixture.updateStaff.mockReset().mockResolvedValue({ success: true, data: state.members[0] })
  fixture.deleteStaff.mockReset().mockResolvedValue({ success: true, data: state.members[0] })
})

afterEach(() => cleanup())

describe('ログインユーザー操作の表示と実処理 (#834)', () => {
  it('別ユーザーの権限のかたまりは保存前APIなしで下書きへコピーする', async () => {
    await mount()
    fireEvent.click(within(rowFor('対象者')).getByRole('button', { name: '中身を見る' }))

    fireEvent.click(screen.getByRole('button', { name: 'ほかの人と同じにする' }))
    fireEvent.click(screen.getByRole('button', { name: 'コピー元のログインユーザー' }))
    fireEvent.click(screen.getByRole('button', { name: 'コピー元さん（見るだけ）' }))

    expect(fixture.updateStaff).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('コピー元さんの「見るだけ」を下書きに反映しました')

    fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    await waitFor(() => expect(fixture.updateStaff).toHaveBeenCalledTimes(1))
    expect(fixture.updateStaff).toHaveBeenCalledWith('target', { role: 'viewer' })
  })

  it('コピー元には対象本人を出さない', async () => {
    await mount()
    fireEvent.click(within(rowFor('対象者')).getByRole('button', { name: '中身を見る' }))
    fireEvent.click(screen.getByRole('button', { name: 'ほかの人と同じにする' }))
    fireEvent.click(screen.getByRole('button', { name: 'コピー元のログインユーザー' }))

    expect(screen.queryByRole('button', { name: '対象者（運用）' })).toBeNull()
    expect(screen.getByRole('button', { name: 'コピー元さん（見るだけ）' })).toBeTruthy()
  })

  it('二段階認証は本人だけ操作でき、他人は状態表示だけになる', async () => {
    await mount()

    expect(within(rowFor('対象者')).queryByRole('button', { name: '入れていません' })).toBeNull()
    expect(within(rowFor('対象者')).getByText('入れていません')).toBeTruthy()
    expect(within(rowFor('ログイン中の人')).getByRole('button', { name: '入れていません' })).toBeTruthy()
  })

  it('外す操作は確認前に呼ばず、確認後の素早い二度押しでも1回だけ呼ぶ', async () => {
    let release: (() => void) | null = null
    fixture.deleteStaff.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ success: true, data: state.members[0] })
    }))
    await mount()

    fireEvent.click(within(rowFor('対象者')).getByRole('button', { name: 'この人を外す' }))
    expect(fixture.deleteStaff).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: '外す' })
    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(fixture.deleteStaff).toHaveBeenCalledTimes(1)
    expect(fixture.deleteStaff).toHaveBeenCalledWith('target')

    await act(async () => { release?.() })
    await waitFor(() => expect(screen.queryByRole('button', { name: '外す' })).toBeNull())
  })

  it('外す操作の失敗理由を確認窓に残し、押し直せる', async () => {
    fixture.deleteStaff.mockRejectedValue(new Error('最後の管理者は外せません'))
    await mount()

    fireEvent.click(within(rowFor('対象者')).getByRole('button', { name: 'この人を外す' }))
    fireEvent.click(screen.getByRole('button', { name: '外す' }))

    await waitFor(() => expect(screen.getByText('最後の管理者は外せません')).toBeTruthy())
    expect(fixture.deleteStaff).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '外す' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
