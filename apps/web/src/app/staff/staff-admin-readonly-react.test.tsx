// @vitest-environment happy-dom
/*
 * IDEA-30 (#1048): 見せる範囲画面の確認性。
 *
 * 実物の StaffPage をマウントして確かめる。
 *   - 管理者の権限確認は書込み不能（保存・項目・かたまり・コピーを出さない/効かせない）
 *   - 対象のLINEアカウントが確認できる
 *   - 管理者以外の対象は従来どおり保存口まで進める
 */
import React from 'react'
import { act } from 'react'
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

const { default: StaffPage } = await import('./page')

async function mount() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('対象者')).toBeTruthy())
}

function rowFor(name: string): HTMLTableRowElement {
  return screen.getByText(name).closest('tr') as HTMLTableRowElement
}

async function openScope(name: string) {
  fireEvent.click(within(rowFor(name)).getByRole('button', { name: '中身を見る' }))
  await waitFor(() => expect(screen.getByText('この決め方で、この人にはこう見えます')).toBeTruthy())
}

beforeEach(() => {
  fixture.updateStaff.mockReset().mockResolvedValue({ success: true, data: state.members[0] })
  state.users[0] = accessUser({})
  state.lineAccounts = []
})

afterEach(() => cleanup())

describe('ログインユーザーの権限確認 (IDEA-30)', () => {
  it('管理者の見せる範囲は書込み不能の確認になる', async () => {
    await mount()
    await openScope('管理者さん')

    // 保存口も下書き変更の入口も出さない・効かせない
    expect(screen.queryByRole('button', { name: /見せる範囲を保存/ })).toBeNull()
    expect((screen.getByRole('button', { name: 'ほかの人と同じにする' }) as HTMLButtonElement).disabled).toBe(true)
    for (const button of screen.getAllByRole('button').filter((item) => item.getAttribute('aria-pressed') !== null)) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    // かたまりの選択も効かせない
    const bundleButton = screen.getAllByRole('button').find((item) => item.textContent?.includes('運用') && item.textContent?.includes('人'))
    expect(bundleButton && (bundleButton as HTMLButtonElement).disabled).toBe(true)
    // 管理者であることと、この画面では確認だけできることを示す
    expect(screen.getByText(/管理者はすべての機能を使えます。/)).toBeTruthy()
    // 管理者向けは一覧へ戻る導線だけが出る（権限編集モーダルではない画面内表示）。
    expect(screen.getByRole('button', { name: '一覧へ戻る' })).toBeTruthy()

    // 戻ると一覧へ戻る
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }))
    await waitFor(() => expect(screen.getByText('対象者')).toBeTruthy())
    expect(fixture.updateStaff).not.toHaveBeenCalled()
  })

  it('対象のLINEアカウントを確認できる', async () => {
    await mount()
    await openScope('対象者')

    expect(screen.getByText('対象のLINEアカウント：すべてのLINEアカウント')).toBeTruthy()
    // 管理者以外は従来どおり保存口へ進める
    expect(screen.getByRole('button', { name: /見せる範囲を保存/ })).toBeTruthy()
  })

  it('担当アカウントが限定されている人は店舗名で確認できる', async () => {
    state.users[0] = accessUser({
      accountScope: { type: 'accounts', assignedLineAccountId: null, lineAccountIds: ['la-1'], includesDescendants: false },
    })
    state.lineAccounts = [{ id: 'la-1', name: 'テスト本店' }]
    await mount()
    await openScope('対象者')

    expect(screen.getByText('対象のLINEアカウント：テスト本店')).toBeTruthy()
  })
})
