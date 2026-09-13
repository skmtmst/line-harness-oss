// @vitest-environment happy-dom
/*
 * N-425/N-432 (#668) 招待の再送を、実物の画面で操作して確かめる。
 *
 * ソース文字列の検査では次が固定できない。ここでは happy-dom へ実物の
 * React をマウントし、実物の Promise を握ったまま押す。
 *
 *   - 「もう一度送る」が再送口を1回だけ叩き、返ってきた新しい期限を
 *     運用者の言葉で帯に出すこと
 *   - 送信中は二度押しを受け付けないこと（送信中に押しても叩き足さない）
 *   - 失敗を握りつぶさず、理由を alert の帯に出し、成功の帯を出さないこと
 *   - 再送ボタンが「管理者」「招待中タブ」「未受諾の人」の3つすべてを
 *     満たすときだけ出ること
 *   - 行に招待の期限が出て、切れているものは切れていると分かること
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  tab: 'invited',
  meRole: 'admin' as 'admin' | 'staff',
  fetchApi: vi.fn(),
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

/* 招待の期限。切れている側と生きている側を、日をまたいで離して置く。 */
const EXPIRED_AT = '2020-01-02T03:04:00.000Z'
const RENEWED_AT = '2099-03-04T05:06:00.000Z'

type Invitee = StaffMember & { inviteExpiresAt?: string | null }

function member(overrides: Partial<Invitee>): Invitee {
  return {
    id: 'invitee-1', name: '招待された人', email: 'invitee@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: false, permissionKeys: [],
    notificationPreferences: {}, inviteStatus: 'pending_email', inviteExpiresAt: EXPIRED_AT,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}
function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'invitee-1', name: '招待された人', email: 'invitee@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: null, hasFieldMasks: null,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: null, lastActionAt: null, mfaEnabled: false, status: 'expired', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', ...overrides,
  }
}

const state = {
  members: [] as Invitee[],
  users: [] as ReturnType<typeof accessUser>[],
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return {
    ApiError,
    fetchApi: fixture.fetchApi,
    api: {
      staff: {
        list: async () => ({ success: true, data: state.members }),
        me: async () => ({ success: true, data: member({ id: 'me-1', name: '管理者', email: 'me@example.test', role: fixture.meRole, isActive: true, inviteStatus: 'active' }) }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: { active: 0, invited: 1, expiredInvitations: 1, unused90Days: 0, mfaEnabled: 0, mfaRate: null, roleCounts: { administrator: 0, operations: 1, reception: 0, view_only: 0, custom: 0 } },
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
  await waitFor(() => expect(screen.getByText('招待された人')).toBeTruthy())
}

function resendButtons() {
  return screen.queryAllByRole('button', { name: /もう一度送る|送信中/ })
}

beforeEach(() => {
  fixture.tab = 'invited'
  fixture.meRole = 'admin'
  fixture.fetchApi.mockReset()
  state.members = [member({})]
  state.users = [accessUser({})]
})
afterEach(() => { cleanup() })

describe('招待の再送 (N-425/N-432 #668)', () => {
  it('押すと再送口を1回だけ叩き、新しい期限と次の対応を帯に出す', async () => {
    fixture.fetchApi.mockImplementation(async () => {
      state.members = [member({ inviteExpiresAt: RENEWED_AT })]
      return { success: true, data: member({ inviteExpiresAt: RENEWED_AT }) }
    })
    await mount()

    await act(async () => { fireEvent.click(resendButtons()[0]) })

    expect(fixture.fetchApi).toHaveBeenCalledTimes(1)
    expect(fixture.fetchApi.mock.calls[0][0]).toBe('/api/staff/invitee-1/resend-invitation')
    expect(fixture.fetchApi.mock.calls[0][1]).toMatchObject({ method: 'POST' })

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('送り直しました')
    /* 新しい期限が JST で出る。日付が読めないと「いつまでに受けてもらうか」が伝わらない。 */
    expect(notice.textContent).toContain('3/4')
    expect(notice.textContent).toContain('期限内に受諾がなければ')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('送信中は二度押しを受け付けない', async () => {
    let release: (() => void) | null = null
    fixture.fetchApi.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ success: true, data: member({ inviteExpiresAt: RENEWED_AT }) })
    }))
    await mount()

    await act(async () => { fireEvent.click(resendButtons()[0]) })
    expect(resendButtons()[0].textContent).toContain('送信中')
    expect((resendButtons()[0] as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { fireEvent.click(resendButtons()[0]) })
    expect(fixture.fetchApi).toHaveBeenCalledTimes(1)

    await act(async () => { release?.() })
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
  })

  it('素早い二度押しでも1回しか叩かない(同じ描画の中で2回届く場合)', async () => {
    fixture.fetchApi.mockImplementation(() => new Promise(() => {}))
    await mount()
    /* 見た目の disabled が効く前に2回届く。2回叩くと1通目のリンクが死ぬ。 */
    const button = resendButtons()[0]
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(fixture.fetchApi).toHaveBeenCalledTimes(1)
  })

  it('失敗したら理由を出し、送れたことにしない', async () => {
    fixture.fetchApi.mockRejectedValue(new Error('このユーザーはすでに利用を開始しています'))
    await mount()

    await act(async () => { fireEvent.click(resendButtons()[0]) })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('すでに利用を開始しています')
    expect(screen.queryByRole('status')).toBeNull()
    /* 失敗しても押し直せる。押せないまま詰むのがこの票のもとの不具合。 */
    expect((resendButtons()[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('行に招待の期限を出し、切れているものは切れていると分かる', async () => {
    await mount()
    expect(screen.getByText(/招待の期限：期限切れ（.*まででした）/)).toBeTruthy()

    cleanup()
    state.members = [member({ inviteExpiresAt: RENEWED_AT })]
    state.users = [accessUser({ status: 'invited' })]
    await mount()
    const label = screen.getByText(/招待の期限：/)
    expect(label.textContent).toContain('まで')
    expect(label.textContent).not.toContain('期限切れ')
  })

  it('利用を始めた人には再送ボタンを出さない', async () => {
    state.members = [member({ inviteStatus: 'active', isActive: true, inviteExpiresAt: null })]
    state.users = [accessUser({ status: 'invited' })]
    await mount()
    expect(resendButtons()).toHaveLength(0)
  })

  it('管理者でなければ再送ボタンを出さない', async () => {
    fixture.meRole = 'staff'
    await mount()
    expect(resendButtons()).toHaveLength(0)
  })

  it('招待中タブ以外には再送ボタンを出さない', async () => {
    fixture.tab = 'members'
    state.users = [accessUser({ status: 'active' })]
    await mount()
    expect(resendButtons()).toHaveLength(0)
  })
})
