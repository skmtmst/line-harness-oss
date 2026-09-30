// @vitest-environment happy-dom
/*
 * R497: 個別設定（custom）の見せる範囲は保存済みをそのまま出す。
 *
 * 直す前: custom の人を開くと受付プリセットで表示し、何も変えず保存すると
 * 保存済みが見せる範囲ごと受付へ変わっていた（更新要求まで送っていた）。
 * 直した後:
 * - 初期表示は保存済みキーどおり（かたまりの当てはめはしない）
 * - 何も変えない保存は更新要求を送らず、権限もセッションも変えない
 * - 行を触った保存は触った行だけ変え、触っていない部分設定を残す
 * - 保存後の読み直しが保存内容と一致する
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
    id: 'staff-1', name: '個別担当', email: 'custom@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true,
    // 受信箱は変えられる、分析は1キーだけの部分設定、配信はなし。
    permissionKeys: ['/chats', '/analytics'],
    permissionViewKeys: [],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false,
    policyVersion: 3, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'staff-1', name: '個別担当', email: 'custom@example.test', jobTitle: null,
    roleBundle: 'custom', featureCount: 2, hasFieldMasks: null,
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
        me: async () => ({ success: true, data: member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin', isActive: true, permissionKeys: [] }) }),
        update: async (id: string, data: unknown) => {
          fixture.updated.push({ id, data })
          // 疑似サーバー：送られたキーを保存済みへ適用する。
          // 保存後の読み直し（load）が保存内容を返す。
          const sent = data as Partial<StaffMember>
          const target = state.members.find((item) => item.id === id)
          if (target) {
            if (sent.permissionKeys !== undefined) target.permissionKeys = sent.permissionKeys
            if (sent.permissionViewKeys !== undefined) target.permissionViewKeys = sent.permissionViewKeys
            if (sent.emailMask !== undefined) target.emailMask = sent.emailMask
          }
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

async function openScopeView() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '中身を見る' })).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '中身を見る' }))
  })
  await waitFor(() => {
    expect(screen.getByText('この決め方で、この人にはこう見えます')).toBeTruthy()
  })
}

function pressed(name: string): boolean {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true'
}

beforeEach(() => {
  fixture.tab = 'members'
  fixture.updated = []
  state.members = [member({}), member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin', isActive: true, permissionKeys: [] })]
  state.users = [accessUser({})]
})

afterEach(() => {
  cleanup()
})

describe('R497 個別設定の表示と保存', () => {
  test('初期表示は保存済みどおり（受付の当てはめをしない）', async () => {
    await openScopeView()
    // 受信箱は保存済みどおり変えられる、配信は出さない。
    expect(pressed('受信箱：変えられる（返信できる）')).toBe(true)
    expect(pressed('配信：出さない（見せない）')).toBe(true)
    // 何も変えていないので変更後の予定は出ない。
    expect(screen.queryByText('変更後の予定')).toBeNull()
    expect(screen.getByText(/いまの設定と同じ内容です/)).toBeTruthy()
  })

  test('何も変えない保存は更新要求を送らず、窓だけ閉じる', async () => {
    await openScopeView()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    })
    // 確認窓は出さず、更新要求も送らない。
    expect(screen.queryByText(/見せる範囲を保存しますか/)).toBeNull()
    expect(fixture.updated).toHaveLength(0)
    // 見せる範囲の窓は閉じて一覧へ戻る。
    await waitFor(() => {
      expect(screen.queryByText('この決め方で、この人にはこう見えます')).toBeNull()
    })
  })

  test('行を触った保存は触った行だけ変え、触っていない部分設定を残す', async () => {
    await openScopeView()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '配信：変えられる（作成・配信できる）' }))
    })
    await waitFor(() => {
      expect(screen.getByText('変更後の予定')).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    })
    await waitFor(() => {
      expect(screen.getByText(/見せる範囲を保存しますか/)).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    await waitFor(() => {
      expect(fixture.updated).toHaveLength(1)
    })
    const sent = fixture.updated[0].data as Record<string, unknown>
    const edit = sent.permissionKeys as string[]
    // 触った配信は変えられるへ（操作キーも組で付く）。
    expect(edit).toContain('/broadcasts')
    expect(edit).toContain('broadcast.definition.edit')
    // 触っていない受信箱と分析の部分設定は残る。
    expect(edit).toContain('/chats')
    expect(edit).toContain('/analytics')
    // 3択の上書き送り（permissionScope）ではなく行単位のキー送り。
    expect(sent.permissionScope).toBeUndefined()
    expect(sent.emailMask).toBe('masked')
  })

  test('保存後の読み直しが保存内容と一致する', async () => {
    await openScopeView()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '配信：変えられる（作成・配信できる）' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    })
    await waitFor(() => {
      expect(screen.getByText(/見せる範囲を保存しますか/)).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    await waitFor(() => {
      expect(fixture.updated).toHaveLength(1)
    })
    // 疑似サーバーが保存を適用済みで、保存後の読み直しも済んでいる。開き直す。
    await waitFor(() => {
      expect(screen.queryByText('この決め方で、この人にはこう見えます')).toBeNull()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '中身を見る' }))
    })
    await waitFor(() => {
      expect(screen.getByText('この決め方で、この人にはこう見えます')).toBeTruthy()
    })
    expect(pressed('配信：変えられる（作成・配信できる）')).toBe(true)
    expect(pressed('受信箱：変えられる（返信できる）')).toBe(true)
    expect(screen.getByText(/いまの設定と同じ内容です/)).toBeTruthy()
  })
})
