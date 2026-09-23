// @vitest-environment happy-dom
/*
 * Issue #620: ログインユーザー検索が不存在語で0件にならない。
 *
 * メンバー一覧の検索欄は「人の名前・メールで検索」。実物の StaffPage を
 * マウントし、次を確かめる。
 *   - 不存在語では空状態（条件に合うログインユーザーはいません）が出る
 *   - 名前とメールを ' ' で繋いだ文字列への跨ぎ一致（別フィールド一致）をしない
 *   - 空白だけ・長文でも正しく動く
 */
import React from 'react'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

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
    id: 'me', name: 'ログイン中の人', email: 'me@example.test', role: 'admin',
    lineLinked: false, twoFactorEnabled: true, isActive: true, permissionKeys: [],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'me', name: 'ログイン中の人', email: 'me@example.test', jobTitle: null,
    roleBundle: 'administrator', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: '2026-09-01T00:00:00.000Z', lastActionAt: null, mfaEnabled: true,
    status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const state = {
  members: [
    member({}),
    member({ id: 'yamada', name: '山田 太郎', email: 'yamada@mail.test', role: 'staff' }),
    member({ id: 'sato', name: '佐藤 花子', email: 'x-sato@mail.test', role: 'staff' }),
  ],
  users: [
    accessUser({}),
    accessUser({ id: 'yamada', name: '山田 太郎', email: 'yamada@mail.test', roleBundle: 'operations', featureCount: 3 }),
    accessUser({ id: 'sato', name: '佐藤 花子', email: 'x-sato@mail.test', roleBundle: 'view_only', featureCount: 2 }),
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
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: {
              active: state.users.length, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 3, mfaRate: 100,
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

const EMPTY_MESSAGE = '条件に合うログインユーザーはいません。条件を変えてお試しください。'

async function mount() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('山田 太郎')).toBeTruthy())
}

function searchBox(): HTMLElement {
  return screen.getByRole('searchbox', { name: '人の名前・メールで検索' })
}

function typeQuery(value: string) {
  fireEvent.change(searchBox(), { target: { value } })
}

afterEach(() => cleanup())

describe('ログインユーザー検索 (#620)', () => {
  it('不存在語は0件になり空状態と件数0を出す', async () => {
    await mount()
    typeQuery('存在しない語zzz')
    await waitFor(() => expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy())
    expect(screen.getByText('ログインユーザー 0人中 0人を表示')).toBeTruthy()
    expect(screen.queryByText('山田 太郎')).toBeNull()
    expect(screen.queryByText('佐藤 花子')).toBeNull()
  })

  it('名前・メールの部分一致は従来どおり効く', async () => {
    await mount()
    typeQuery('山田')
    await waitFor(() => expect(screen.getByText('ログインユーザー 1人中 1人を表示')).toBeTruthy())
    expect(screen.getByText('山田 太郎')).toBeTruthy()
    expect(screen.queryByText('佐藤 花子')).toBeNull()

    typeQuery('x-sato@mail')
    await waitFor(() => expect(screen.getByText('佐藤 花子')).toBeTruthy())
    expect(screen.queryByText('山田 太郎')).toBeNull()
  })

  it('名前とメールをまたいだ語では一致しない（フィールドごとに照合する）', async () => {
    await mount()
    // 旧実装は "名前 メール" を1本の文字列へ繋げて照合していたため、
    // 「花子 x-sato」のような跨ぎ語でも行を返していた。
    typeQuery('花子 x-sato')
    await waitFor(() => expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy())
    expect(screen.getByText('ログインユーザー 0人中 0人を表示')).toBeTruthy()
  })

  it('空白だけの検索語は絞り込みなしとして全件を返す', async () => {
    await mount()
    typeQuery('  　 ')
    await waitFor(() => expect(screen.getByText('ログインユーザー 3人中 3人を表示')).toBeTruthy())
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull()
  })

  it('長文の検索語でも0件の空状態になり、画面は壊れない', async () => {
    await mount()
    typeQuery('な'.repeat(2000))
    await waitFor(() => expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy())
    expect(screen.getByText('ログインユーザー 0人中 0人を表示')).toBeTruthy()
  })

  it('検索語を消すと全件へ戻る', async () => {
    await mount()
    typeQuery('存在しない語zzz')
    await waitFor(() => expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy())
    typeQuery('')
    await waitFor(() => expect(screen.getByText('ログインユーザー 3人中 3人を表示')).toBeTruthy())
    expect(screen.getByText('山田 太郎')).toBeTruthy()
    expect(screen.getByText('佐藤 花子')).toBeTruthy()
  })
})
