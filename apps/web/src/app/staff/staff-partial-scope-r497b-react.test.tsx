// @vitest-environment happy-dom
/*
 * R497b: 一部だけ許可（例：分析の1キーのみ）の表示を正確にする。
 *
 * 保存済みに分析の1キー（/analytics）だけがあるとき、3択の写しは
 * その行を none（出さない）にする。実際には /analytics が使えるので、
 * そのまま「出さない」と押した表示にするのは保存内容と違う。
 * 直した後:
 * - 分析行の3択はどれも押さず、「一部だけ許可」の内訳を別に示す
 * - 右欄の「出さない」数に一部行を数えない
 * - 何も変えない保存は更新要求を送らない
 * - 行を触った保存は触った行だけ変え、分析の1キーを残す
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

describe('R497b 一部だけ許可の表示と保存', () => {
  test('分析の一部は「出さない」と押さず、内訳を別に示す', async () => {
    await openScopeView()
    // 受信箱は保存済みどおり変えられる。
    expect(pressed('受信箱：変えられる（返信できる）')).toBe(true)
    // 分析は一部だけ許可なので、3択のどれも押さない。
    // 直す前は「出さない」が押されていた（保存内容と違う）。
    expect(pressed('分析：変えられる（承認・変更できる）')).toBe(false)
    expect(pressed('分析：見えるだけ（閲覧のみ）')).toBe(false)
    expect(pressed('分析：出さない（見せない）')).toBe(false)
    // 行の下に内訳が出る。
    expect(screen.getByText(/一部だけ許可されています/)).toBeTruthy()
    expect(screen.getByText(/いまの設定と同じ内容です/)).toBeTruthy()
  })

  test('右欄の「出さない」数に一部行を数えず、一部の行を別に示す', async () => {
    await openScopeView()
    // 機能10行のうち出るのは受信箱だけ、一部（分析）はどちらにも数えない。
    expect(screen.getByText(/メニューに出るのは1項目/)).toBeTruthy()
    expect(screen.getByText(/出さないのは8項目/)).toBeTruthy()
    expect(screen.getByText(/一部だけ許可が1行あります/)).toBeTruthy()
  })

  test('何も変えない保存は更新要求を送らず、窓だけ閉じる', async () => {
    await openScopeView()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    })
    expect(screen.queryByText(/見せる範囲を保存しますか/)).toBeNull()
    expect(fixture.updated).toHaveLength(0)
    await waitFor(() => {
      expect(screen.queryByText('この決め方で、この人にはこう見えます')).toBeNull()
    })
  })

  test('行を触った保存は触った行だけ変え、分析の一部を残す', async () => {
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
    expect(edit).toContain('/broadcasts')
    expect(edit).toContain('broadcast.definition.edit')
    expect(edit).toContain('/chats')
    // 触っていない分析の一部は残る。
    expect(edit).toContain('/analytics')
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
    // 分析の一部は読み直しても一部のまま。
    expect(pressed('分析：出さない（見せない）')).toBe(false)
    expect(screen.getByText(/一部だけ許可されています/)).toBeTruthy()
    expect(screen.getByText(/いまの設定と同じ内容です/)).toBeTruthy()
  })

  test('かたまり・コピーが全体の置き換えであることを言葉で伝える', async () => {
    await openScopeView()
    expect(screen.getByText(/かたまりを選ぶとすべての行がその内容に置き換わり/)).toBeTruthy()
    expect(screen.getByText(/行を選び直すとその行だけ置き換わり/)).toBeTruthy()
  })
})
