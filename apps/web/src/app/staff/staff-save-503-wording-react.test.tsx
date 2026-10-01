// @vitest-environment happy-dom
/*
 * R497-SAVE-WORDING: 保存503の配線（見せる範囲の保存catch → helper → dialog/footer）。
 *
 * helper 本体が 503 を日本語へ変えることは
 * staff-save-503-wording-contract.test.ts が本物で守る。
 * ここでは「保存catch が messageOf ではなく describeSaveFailure を通り、
 * その結果が確認窓と下の帯の両方に出て、生の API error:503 が出ない」
 * ことだけを守る。409/step-up/部分権限/idempotency/再試行は触らない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  tab: 'members',
  helperCalls: [] as unknown[],
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
  // 製品の fallback と同じ既定文（message 省略時は API error:<status>）。
  class ApiError extends Error {
    status: number
    code?: string
    constructor(status: number, message?: string, code?: string) {
      super(message ?? `API error: ${status}`)
      this.status = status
      this.code = code
    }
  }
  return {
    ApiError,
    fetchApi: vi.fn(),
    // 配線の証明用：固定の目印を返し、呼ばれた入力を残す。
    // 503→日本語の変換自体は contract 側が本物で守る。
    describeSaveFailure: vi.fn((err: unknown) => {
      fixture.helperCalls.push(err)
      return '保存案内（ヘルパー経由）'
    }),
    api: {
      staff: {
        list: async () => ({ success: true, data: state.members }),
        me: async () => ({ success: true, data: member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin', isActive: true, permissionKeys: [] }) }),
        update: async () => {
          throw new ApiError(503)
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
  fixture.helperCalls = []
  state.members = [member({}), member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: 'admin', isActive: true, permissionKeys: [] })]
  state.users = [accessUser({})]
})

afterEach(() => {
  cleanup()
})

describe('R497-SAVE-WORDING 保存503の配線', () => {
  test('503の保存失敗は確認窓と下の帯にヘルパーの案内を出し、生文を出さない', async () => {
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
    // 行を触って dirty にする。
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
      // 確認窓と下の帯の両方にヘルパーの案内が出る。
      expect(screen.getAllByText('保存案内（ヘルパー経由）')).toHaveLength(2)
    })
    // 生の API error:503 はどこにも出ない。
    expect(screen.queryByText(/API error:/)).toBeNull()
    // helper に 503 が渡っている（messageOf 直出しではない）。
    expect(fixture.helperCalls).toHaveLength(1)
    expect((fixture.helperCalls[0] as { status?: number }).status).toBe(503)
  })
})
